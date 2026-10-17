import type { Plugin } from "@opencode/plugin";
import type { LogFn } from "@opencode-pets/core";
import { PET_DIALOGS, PetsRpc } from "./rpc.js";
import { PetController } from "./runtime.js";
import type { PetNotifier } from "./runtime.js";

/**
 * V2 server plugin (OpenCode 2.x). Runs the shared controller and exposes
 * the `/pet` command through the command domain. Dialogs and toasts reach
 * the TUI leg through RPC events; SSE streams drive pet state directly.
 */
export const v2Setup = async (ctx: Plugin.Context): Promise<Plugin.Cleanup> => {
  // The V2 plugin context has no logger, so route structured logs to stderr.
  const log: LogFn = (level, message, extra) => {
    const suffix = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
    console.error(`[opencode-pets] ${level}: ${message}${suffix}`);
  };

  // The transition line (OpenCode 1.18.29–1.19.3) loads the same config entry
  // twice: once through the legacy V1 loader and once through the early
  // definition host. That host predates the RPC domain, and the legacy leg
  // already provides the full feature set there (command, dialogs, toasts), so
  // this leg stands down to avoid a duplicate controller on those hosts.
  if (typeof ctx.rpc?.register !== "function") {
    log(
      "debug",
      "Pre-RPC host detected — V2 leg disabled (legacy hooks handle this session)",
    );
    return () => {};
  }

  // RPC lets the server leg drive the TUI leg's dialogs and toasts. When the
  // RPC host refuses registration, notifications degrade to silent no-ops.
  const registration = await (async () => {
    try {
      return await ctx.rpc.register(PetsRpc, {});
    } catch (error) {
      log("warn", "RPC registration failed — dialogs and toasts disabled", {
        error: String(error),
      });
      return null;
    }
  })();

  const notifier: PetNotifier = {
    dialog(kind) {
      const dialog = PET_DIALOGS[kind];
      void registration?.events
        .emit("dialog", { title: dialog.title, message: dialog.message })
        .catch(() => {});
    },
    toast(message, variant) {
      void registration?.events
        .emit("toast", { message, variant })
        .catch(() => {});
    },
  };

  const controller = new PetController(notifier, log);
  await controller.init();

  await ctx.command.transform((editor) => {
    editor.add({
      name: "pet",
      description: "Show or hide the virtual pet overlay",
      execute: async () => {
        await controller.runCommand();
      },
    });
  });

  await ctx.tool.hook("execute.before", (event) => {
    controller.handleToolRunning(event.tool);
  });

  await ctx.tool.hook("execute.after", () => {
    controller.handleToolCompleted();
  });

  const abort = new AbortController();
  void (async () => {
    for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
      controller.handleSseEvent(event);
    }
  })().catch((error) => {
    log("warn", "SSE subscription ended", { error: String(error) });
  });

  return () => {
    abort.abort();
    controller.dispose();
  };
};
