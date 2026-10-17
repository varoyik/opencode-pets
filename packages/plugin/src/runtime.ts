import type { Subprocess } from "bun";
import { IpcClient } from "./ipc-client.js";
import { spawnOverlay, killOverlay } from "./overlay-manager.js";
import { StateDeriver } from "./state-deriver.js";
import type { SseEventLike } from "./state-deriver.js";
import { readConfig, watchConfig } from "./config.js";
import { scanPets } from "./pet-scanner.js";
import { ensureOverlayInstalled } from "./overlay-downloader.js";
import { getSocketPath } from "@opencode-pets/core";
import type { Config, LogFn, PetManifest } from "@opencode-pets/core";
import { PET_CRASH_MESSAGE } from "./rpc.js";
import type { PetsDialogKind, ToastVariant } from "./rpc.js";

/**
 * Outbound notification surface. Each OpenCode generation provides its own
 * implementation (TUI publish + toast on V1, RPC events on V2). Implementations
 * must never reject — failures degrade to silent no-ops.
 */
export interface PetNotifier {
  dialog(kind: PetsDialogKind): Promise<void> | void;
  toast(message: string, variant: ToastVariant): Promise<void> | void;
}

/**
 * Generation-agnostic pet runtime: owns config, pets, the IPC client, the
 * state deriver, the overlay process, and the `/pet` command behavior.
 */
export class PetController {
  private readonly notify: PetNotifier;
  private readonly log: LogFn;
  private readonly config: Config;
  private pets: PetManifest[] = [];
  private ipcClient: IpcClient | null = null;
  private stateDeriver: StateDeriver | null = null;
  private overlayProcess: Subprocess | null = null;
  private unwatchConfig: (() => void) | null = null;

  constructor(notify: PetNotifier, log: LogFn) {
    this.notify = notify;
    this.log = log;
    this.config = readConfig(log);
  }

  /**
   * Scan pets and ensure the overlay binary is installed. Only when the
   * overlay is available are the IPC client and state deriver created;
   * otherwise `/pet` reports the error dialog and does nothing else.
   */
  async init(): Promise<void> {
    this.pets = scanPets(this.log);

    // Auto-download overlay binary. On failure, load plugin without pet management.
    const overlayAvailable = await ensureOverlayInstalled(
      this.log,
      (message, variant) => {
        void this.notify.toast(message, variant);
      },
    );
    if (!overlayAvailable) return;

    const ipcClient = new IpcClient(getSocketPath(), this.log, () => {
      void this.notify.toast(PET_CRASH_MESSAGE, "error");
    });
    this.ipcClient = ipcClient;
    this.stateDeriver = new StateDeriver(ipcClient, this.config.idleTimeoutMs);

    ipcClient.onSwitchPet((petId: string) => {
      const pet = this.pets.find((p) => p.id === petId);
      if (!pet) {
        this.log("warn", `Unknown pet ID requested: ${petId}`);
        void this.notify.toast(`Pet "${petId}" not found`, "warning");
        return;
      }
      ipcClient.sendSwitchPet(pet.id, pet.spritesheetPath);
    });

    ipcClient.onQuitPet(() => {
      if (this.overlayProcess) {
        killOverlay(this.overlayProcess, this.log);
        this.overlayProcess = null;
      }
    });
  }

  handleSseEvent(event: SseEventLike): void {
    this.stateDeriver?.handleSseEvent(event);
  }

  handleToolRunning(toolName: string): void {
    this.stateDeriver?.handleEvent({ type: "ToolRunning", toolName });
  }

  handleToolCompleted(): void {
    this.stateDeriver?.handleEvent({ type: "ToolCompleted" });
  }

  /**
   * Run `/pet`: spawn the overlay (first use, after quit, or after crash) or
   * toggle its visibility when already running, then report via the notifier.
   */
  async runCommand(): Promise<void> {
    const ipcClient = this.ipcClient;
    const stateDeriver = this.stateDeriver;

    if (!ipcClient || !stateDeriver) {
      await this.notify.dialog("error");
      return;
    }

    const overlayDead =
      this.overlayProcess === null || this.overlayProcess.exitCode !== null;

    if (ipcClient.isOverlayQuitting() || overlayDead) {
      // Respawn after intentional quit or first use / crash.
      // Reset quitting state so the new overlay can connect.
      ipcClient.resetQuittingState();
      ipcClient.setOverlayHidden(false);
      this.overlayProcess = spawnOverlay();
      // Reset state deriver so stale pre-spawn counters don't leak
      stateDeriver.reset();
      ipcClient.sendConfig(this.config);
      ipcClient.sendPets(this.pets);
      this.switchToDefaultPet(this.config.defaultPet);
      ipcClient.sendCurrentMood("idle");

      // Start config watcher after first spawn
      if (!this.unwatchConfig) {
        const initialDefaultPet = this.config.defaultPet;
        this.unwatchConfig = watchConfig((newConfig: Config) => {
          ipcClient.sendConfig(newConfig);
          if (newConfig.defaultPet !== initialDefaultPet) {
            this.switchToDefaultPet(newConfig.defaultPet);
          }
        }, this.log);
      }

      await this.notify.dialog("launch");
    } else {
      // Already running → toggle visibility
      ipcClient.toggleVisibility();
      // Optimistically clear hidden flag — toggle will show if hidden.
      ipcClient.setOverlayHidden(false);
      await this.notify.dialog("toggle");
    }
  }

  dispose(): void {
    this.stateDeriver?.dispose();
    this.stateDeriver = null;
    if (this.overlayProcess) {
      killOverlay(this.overlayProcess, this.log);
      this.overlayProcess = null;
    }
    this.ipcClient?.close();
    this.ipcClient = null;
    if (this.unwatchConfig) {
      this.unwatchConfig();
      this.unwatchConfig = null;
    }
  }

  private switchToDefaultPet(defaultPetId: string): void {
    const ipcClient = this.ipcClient;
    if (!ipcClient) return;

    const pet = this.pets.find((p) => p.id === defaultPetId);
    if (pet) {
      ipcClient.sendSwitchPet(pet.id, pet.spritesheetPath);
    } else {
      this.log(
        "warn",
        `Unknown defaultPet "${defaultPetId}" — not in scanned pet list`,
      );
      void this.notify.toast(
        `Pet "${defaultPetId}" not found — using current pet`,
        "warning",
      );
    }
  }
}
