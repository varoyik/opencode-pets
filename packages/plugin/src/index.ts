import type { Plugin } from "@opencode-ai/plugin";
import { IpcClient } from "./ipc-client.js";
import { startOverlay, killOverlay } from "./overlay-manager.js";
import { StateDeriver } from "./state-deriver.js";

const petPlugin: Plugin = async (_input) => {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const socketPath = `/tmp/opencode-pets-${uid}/opencode-pets.sock`;

  const ipcClient = new IpcClient(socketPath);
  const stateDeriver = new StateDeriver(ipcClient);
  const overlayProcess = await startOverlay(socketPath);
  const overlayStarted = overlayProcess !== undefined;

  return {
    config: async (config) => {
      if (config.command === undefined) {
        config.command = {};
      }
      config.command["pet"] = {
        template: "_",
        description: "Show or hide the virtual pet overlay",
      };
    },

    event: async ({ event }) => {
      // Shutdown: kill overlay process and close IPC connection.
      // "global.disposed" is v2-only but checked at runtime; widen to string
      // to avoid a type-level overlap error with the v1 Event union.
      const eventType: string = event.type;
      if (
        eventType === "server.instance.disposed" ||
        eventType === "global.disposed"
      ) {
        stateDeriver.dispose();
        if (overlayProcess) {
          killOverlay(overlayProcess);
        }
        ipcClient.close();
        return;
      }

      stateDeriver.handleSseEvent(event);
    },

    "tool.execute.before": async () => {
      stateDeriver.handleEvent({ type: "ToolRunning" });
    },

    "tool.execute.after": async () => {
      stateDeriver.handleEvent({ type: "TaskCompleted" });
    },

    "command.execute.before": async (input, output) => {
      if (input.command !== "pet") return;

      if (!overlayStarted) {
        output.parts.length = 0;
        output.parts.push({
          type: "text",
          text: "Pet overlay is not running. It may have been closed.",
        } as any);
        return;
      }

      ipcClient.toggleVisibility();
      output.parts.length = 0;
      output.parts.push({
        type: "text",
        text: "Pet visibility toggled.",
      } as any);
    },
  };
};

export default petPlugin;
