import type { Plugin } from "@opencode-ai/plugin";
import { IpcClient } from "./ipc-client.js";
import { startOverlay, killOverlay } from "./overlay-manager.js";
import { StateDeriver } from "./state-deriver.js";

const petPlugin: Plugin = async (input) => {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const socketPath = `/tmp/opencode-pets-${uid}/opencode-pets.sock`;
  const client = input.client;

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
        template: "__PET_COMMAND__",
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

    "command.execute.before": async (cmdInput, _output) => {
      if (cmdInput.command !== "pet") return;

      if (!overlayStarted) {
        throw new Error("Pet overlay is not running. It may have been closed.");
      }

      ipcClient.toggleVisibility();

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
              text: "Pet visibility toggled.",
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
