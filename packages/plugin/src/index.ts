import type { Subprocess } from "bun";
import type { Plugin } from "@opencode-ai/plugin";
import { IpcClient } from "./ipc-client.js";
import { spawnOverlay, killOverlay } from "./overlay-manager.js";
import { StateDeriver } from "./state-deriver.js";
import { readConfig, watchConfig } from "./config.js";
import { scanPets } from "./pet-scanner.js";
import type { Config, LogFn } from "@opencode-pets/core";

const petPlugin: Plugin = async (input) => {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const socketPath = `/tmp/opencode-pets-${uid}/opencode-pets.sock`;
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

  // Initialize config and pets
  const config = readConfig(log);
  const pets = scanPets(log);

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

  ipcClient.onHidden(() => {
    // Overlay hidden — no action needed.
  });

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

      let message: string;

      const overlayDead =
        overlayProcess === null || overlayProcess.exitCode !== null;

      if (ipcClient.isOverlayQuitting() || overlayDead) {
        // Respawn after intentional quit or first use / crash.
        // Reset quitting state so the new overlay can connect.
        ipcClient.resetQuittingState();
        ipcClient.setOverlayHidden(false);
        overlayProcess = spawnOverlay();
        // Send config + pets + default pet, then current mood
        ipcClient.sendConfig(config);
        ipcClient.sendPets(pets);
        switchToDefaultPet(config.defaultPet);
        ipcClient.sendCurrentMood(stateDeriver.getCurrentMood());
        message = "Pet overlay launched.";

        // Start config watcher after first spawn
        if (!unwatchConfig) {
          unwatchConfig = watchConfig((newConfig: Config) => {
            ipcClient.sendConfig(newConfig);
            // Auto-switch if defaultPet changed
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
        message = "Pet visibility toggled.";
      }

      // Inject noReply message (chat entry, no LLM trigger).
      // Throw __PET_HANDLED__ to abort command flow — prevents LLM
      // from processing /pet.
      await client.session.prompt({
        path: { id: cmdInput.sessionID },
        body: {
          noReply: true,
          parts: [
            {
              type: "text",
              text: message,
              ignored: true,
            },
          ],
        },
      });

      throw new Error("__PET_HANDLED__");
    },
  };
};

export default petPlugin;
