/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { Plugin as TuiV2Plugin } from "@opencode/plugin/tui";
import { PET_DIALOGS, PET_TOAST_VARIANTS, PetsRpc } from "../rpc.js";
import type { PetsDialogKind, ToastVariant } from "../rpc.js";

const AUTO_CLOSE_MS = 3000;

/**
 * V1 TUI leg — the server leg requests these keymap commands through
 * `client.tui.publish({ type: "tui.command.execute", ... })`.
 */
const showV1Dialog = (
  api: Parameters<TuiPlugin>[0],
  kind: PetsDialogKind,
  timerHolder: { current: ReturnType<typeof setTimeout> | null },
): void => {
  if (timerHolder.current !== null) {
    clearTimeout(timerHolder.current);
    timerHolder.current = null;
  }

  // Fires when the dialog is cleared by any means — DialogAlert's Enter/OK/Esc
  // handlers or our auto-close timeout. Cleans up the timer in all cases.
  const onClose = () => {
    if (timerHolder.current !== null) {
      clearTimeout(timerHolder.current);
      timerHolder.current = null;
    }
  };

  const dialog = PET_DIALOGS[kind];

  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(
    () => <api.ui.DialogAlert title={dialog.title} message={dialog.message} />,
    onClose,
  );

  timerHolder.current = setTimeout(() => {
    api.ui.dialog.clear();
  }, AUTO_CLOSE_MS);
};

const tui: TuiPlugin = async (api, _options, _meta) => {
  const timerHolder: { current: ReturnType<typeof setTimeout> | null } = {
    current: null,
  };

  api.keymap.registerLayer({
    commands: [
      {
        name: "pet.show_dialog_launch",
        title: "Pet Dialog (Launch)",
        category: "OpenCode Pets",
        run() {
          showV1Dialog(api, "launch", timerHolder);
        },
      },
      {
        name: "pet.show_dialog_toggle",
        title: "Pet Dialog (Toggle)",
        category: "OpenCode Pets",
        run() {
          showV1Dialog(api, "toggle", timerHolder);
        },
      },
      {
        name: "pet.show_dialog_error",
        title: "Pet Dialog (Error)",
        category: "OpenCode Pets",
        run() {
          showV1Dialog(api, "error", timerHolder);
        },
      },
    ],
    bindings: [],
  });

  api.lifecycle.onDispose(() => {
    if (timerHolder.current !== null) {
      clearTimeout(timerHolder.current);
    }
  });
};

/**
 * V2 TUI leg — the server leg emits `dialog` / `toast` RPC events; this leg
 * renders them as a built-in alert (3s auto-close) and a toast.
 */
const v2Setup = async (
  context: TuiV2Plugin.Context,
): Promise<TuiV2Plugin.Cleanup> => {
  // The transition line (OpenCode 1.18.29–1.19.3) can load this TUI module
  // through both the legacy loader and the early definition host. That host
  // predates the RPC domain; the legacy leg already renders dialogs there, so
  // this leg stands down when the RPC client is unavailable.
  if (typeof context.client?.rpc !== "function") {
    return () => {};
  }

  const rpc = context.client.rpc(PetsRpc);
  const locationDirectory = context.location?.directory;

  const matchesLocation = (event: {
    readonly location: { readonly directory: string };
  }): boolean =>
    locationDirectory === undefined ||
    event.location.directory === locationDirectory;

  let dialogGeneration = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const showDialog = (title: string, message: string): void => {
    clearTimer();
    const generation = ++dialogGeneration;

    // Auto-close if the user leaves the dialog open. The bookkeeping below
    // clears the timer when the dialog closes early, so a stale timer can
    // never clear a different dialog.
    timer = setTimeout(() => {
      timer = null;
      if (dialogGeneration === generation) {
        context.ui.dialog.clear();
      }
    }, AUTO_CLOSE_MS);

    void context.ui.dialog
      .alert({ title, message })
      .catch(() => {})
      .finally(() => {
        if (dialogGeneration === generation) {
          dialogGeneration = 0;
          clearTimer();
        }
      });
  };

  const offDialog = rpc.events.on("dialog", (event) => {
    if (!matchesLocation(event)) return;
    const title = event.data["title"];
    const message = event.data["message"];
    if (typeof message !== "string" || message === "") return;
    showDialog(
      typeof title === "string" && title !== ""
        ? title
        : PET_DIALOGS.launch.title,
      message,
    );
  });

  const offToast = rpc.events.on("toast", (event) => {
    if (!matchesLocation(event)) return;
    const message = event.data["message"];
    if (typeof message !== "string" || message === "") return;
    const variant = readToastVariant(event.data["variant"]);
    context.ui.toast.show(
      variant === undefined ? { message } : { message, variant },
    );
  });

  return () => {
    offDialog();
    offToast();
    clearTimer();
    if (dialogGeneration !== 0) {
      dialogGeneration = 0;
      context.ui.dialog.clear();
    }
  };
};

function readToastVariant(value: unknown): ToastVariant | undefined {
  return PET_TOAST_VARIANTS.find((variant) => variant === value);
}

/**
 * Dual-mode TUI plugin module.
 *
 * - V1 (OpenCode >= 1.18.29) reads this as a TUI plugin module: `tui` runs
 *   and the extra `setup` key is ignored.
 * - V2 (OpenCode 2.x) reads this as a TUI plugin definition: `setup` runs
 *   and the extra `tui` key is ignored.
 */
const plugin = {
  id: "opencode-pets",
  tui,
  setup: v2Setup,
} satisfies Pick<TuiPluginModule, "tui"> & TuiV2Plugin.Definition;

export default plugin;
