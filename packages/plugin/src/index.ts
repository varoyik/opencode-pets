import type { Subprocess } from "bun";
import type { Plugin } from "@opencode-ai/plugin";
import { IpcClient } from "./ipc-client.js";
import { spawnOverlay, killOverlay } from "./overlay-manager.js";
import { StateDeriver } from "./state-deriver.js";
import { readConfig, watchConfig } from "./config.js";
import { scanPets } from "./pet-scanner.js";
import { ensureOverlayInstalled } from "./overlay-downloader.js";
import { getSocketPath } from "@opencode-pets/core";
import type { Config, LogFn } from "@opencode-pets/core";

const petPlugin: Plugin = async (input) => {
  const socketPath = getSocketPath();
  const client = input.client;

  const log: LogFn = (level, message, extra) => {
    const body: {
      service: string;
      level: typeof level;
      message: string;
      extra?: Record<string, unknown>;
    } = { service: "opencode-pets", level, message };
    if (extra !== undefined) body.extra = extra;
    client.app.log({ body }).catch(() => {});
  };

  function toast(
    message: string,
    variant: "info" | "success" | "warning" | "error",
  ): void {
    client.tui
      .showToast({
        body: { message, variant },
      })
      .catch(() => {});
  }

  const config = readConfig(log);
  const pets = scanPets(log);

  // Auto-download overlay binary. On failure, load plugin without pet management.
  const overlayAvailable = await ensureOverlayInstalled(client, log);

  if (!overlayAvailable) {
    return {
      config: async (config) => {
        if (config.command === undefined) {
          config.command = {};
        }
        config.command["pet"] = {
          template: "__PET_COMMAND__",
          description: "Show or hide the virtual pet overlay",
        };
      },
      dispose: async () => {},
      event: async () => {},
      "tool.execute.before": async () => {},
      "tool.execute.after": async () => {},
      "command.execute.before": async (cmdInput, _output) => {
        if (cmdInput.command !== "pet") return;
        // Show a DialogAlert (when tui.json entry is present) to overlay the
        // sentinel error; falls back to raw error if TUI plugin isn't loaded.
        await client.tui
          .publish({
            body: {
              type: "tui.command.execute",
              properties: { command: "pet.show_dialog_error" },
            },
          })
          .catch(() => {});
        throw new Error("__PET_HANDLED__");
      },
    };
  }

  const ipcClient = new IpcClient(socketPath, log, () => {
    toast("Pet overlay crashed — launch with /pet to restart", "error");
  });
  const stateDeriver = new StateDeriver(ipcClient, config.idleTimeoutMs);

  function switchToDefaultPet(defaultPetId: string): void {
    const pet = pets.find((p) => p.id === defaultPetId);
    if (pet) {
      ipcClient.sendSwitchPet(pet.id, pet.spritesheetPath);
    } else {
      log(
        "warn",
        `Unknown defaultPet "${defaultPetId}" — not in scanned pet list`,
      );
      toast(`Pet "${defaultPetId}" not found — using current pet`, "warning");
    }
  }

  let overlayProcess: Subprocess | null = null;
  let unwatchConfig: (() => void) | null = null;

  ipcClient.onSwitchPet((petId: string) => {
    const pet = pets.find((p) => p.id === petId);
    if (!pet) {
      log("warn", `Unknown pet ID requested: ${petId}`);
      toast(`Pet "${petId}" not found`, "warning");
      return;
    }
    ipcClient.sendSwitchPet(pet.id, pet.spritesheetPath);
  });

  ipcClient.onQuitPet(() => {
    if (overlayProcess) {
      killOverlay(overlayProcess, log);
      overlayProcess = null;
    }
  });

  ipcClient.onHidden(() => {});

  return {
    config: async (config) => {
      if (config.command === undefined) {
        config.command = {};
      }
      config.command["pet"] = {
        template: "__PET_COMMAND__",
        description: "Show or hide the virtual pet overlay",
      };
    },

    dispose: async () => {
      stateDeriver.dispose();
      if (overlayProcess) {
        killOverlay(overlayProcess, log);
        overlayProcess = null;
      }
      ipcClient.close();
      if (unwatchConfig) {
        unwatchConfig();
        unwatchConfig = null;
      }
    },

    event: async ({ event }) => {
      stateDeriver.handleSseEvent(event);
    },

    "tool.execute.before": async (input) => {
      stateDeriver.handleEvent({ type: "ToolRunning", toolName: input.tool });
    },

    "tool.execute.after": async () => {
      stateDeriver.handleEvent({ type: "ToolCompleted" });
    },

    "command.execute.before": async (cmdInput, _output) => {
      if (cmdInput.command !== "pet") return;

      let dialogCommand: string;

      const overlayDead =
        overlayProcess === null || overlayProcess.exitCode !== null;

      if (ipcClient.isOverlayQuitting() || overlayDead) {
        // Respawn after intentional quit or first use / crash.
        // Reset quitting state so the new overlay can connect.
        ipcClient.resetQuittingState();
        ipcClient.setOverlayHidden(false);
        overlayProcess = spawnOverlay();
        // Reset state deriver so stale pre-spawn counters don't leak
        stateDeriver.reset();
        ipcClient.sendConfig(config);
        ipcClient.sendPets(pets);
        switchToDefaultPet(config.defaultPet);
        ipcClient.sendCurrentMood("idle");
        dialogCommand = "pet.show_dialog_launch";

        // Start config watcher after first spawn
        if (!unwatchConfig) {
          unwatchConfig = watchConfig((newConfig: Config) => {
            ipcClient.sendConfig(newConfig);
            if (newConfig.defaultPet !== config.defaultPet) {
              switchToDefaultPet(newConfig.defaultPet);
            }
          }, log);
        }
      } else {
        // Already running → toggle visibility
        ipcClient.toggleVisibility();
        // Optimistically clear hidden flag — toggle will show if hidden.
        ipcClient.setOverlayHidden(false);
        dialogCommand = "pet.show_dialog_toggle";
      }

      // Dialog overlays the sentinel error from the throw below;
      // on close/auto-close the session re-renders without it.
      await client.tui
        .publish({
          body: {
            type: "tui.command.execute",
            properties: { command: dialogCommand },
          },
        })
        .catch(() => {});

      // Throw aborts the command flow — prevents the LLM from processing /pet.
      throw new Error("__PET_HANDLED__");
    },
  };
};

export default petPlugin;
