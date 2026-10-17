import type { Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import type { LogFn } from "@opencode-pets/core";
import { PetController } from "./runtime.js";
import type { PetNotifier } from "./runtime.js";
import type { PetsDialogKind } from "./rpc.js";

/** Sentinel error thrown to block the LLM from processing `/pet`. */
export const PET_HANDLED_SENTINEL = "__PET_HANDLED__";

/** TUI-plugin commands that render each dialog kind in the V1 TUI leg. */
const DIALOG_COMMANDS: Record<PetsDialogKind, string> = {
  launch: "pet.show_dialog_launch",
  toggle: "pet.show_dialog_toggle",
  error: "pet.show_dialog_error",
};

/** V1 notifications: TUI publish for dialogs, `client.tui.showToast` for toasts. */
function createNotifier(client: PluginInput["client"]): PetNotifier {
  return {
    async dialog(kind) {
      // Dialog overlays the sentinel error thrown by the /pet command;
      // on close/auto-close the session re-renders without it.
      await client.tui
        .publish({
          body: {
            type: "tui.command.execute",
            properties: { command: DIALOG_COMMANDS[kind] },
          },
        })
        .catch(() => {});
    },
    toast(message, variant) {
      client.tui.showToast({ body: { message, variant } }).catch(() => {});
    },
  };
}

/**
 * V1 server plugin (OpenCode >= 1.18.29). The `config` hook registers the
 * `/pet` command; `command.execute.before` runs the controller and throws a
 * sentinel error so the LLM never sees the command.
 */
export const v1Server = async (
  input: PluginInput,
  _options?: PluginOptions,
): Promise<Hooks> => {
  const log: LogFn = (level, message, extra) => {
    const body: {
      service: string;
      level: typeof level;
      message: string;
      extra?: Record<string, unknown>;
    } = { service: "opencode-pets", level, message };
    if (extra !== undefined) body.extra = extra;
    input.client.app.log({ body }).catch(() => {});
  };

  const controller = new PetController(createNotifier(input.client), log);
  await controller.init();

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
      controller.dispose();
    },

    event: async ({ event }) => {
      controller.handleSseEvent(event);
    },

    "tool.execute.before": async (toolInput) => {
      controller.handleToolRunning(toolInput.tool);
    },

    "tool.execute.after": async () => {
      controller.handleToolCompleted();
    },

    "command.execute.before": async (cmdInput, _output) => {
      if (cmdInput.command !== "pet") return;
      await controller.runCommand();
      // Throw aborts the command flow — prevents the LLM from processing /pet.
      throw new Error(PET_HANDLED_SENTINEL);
    },
  };
};
