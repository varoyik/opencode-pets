/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const AUTO_CLOSE_MS = 3000;

const showDialog = (
  api: Parameters<TuiPlugin>[0],
  message: string,
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

  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(
    () => <api.ui.DialogAlert title="Pet Status" message={message} />,
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
          showDialog(api, "Pet overlay launched.", timerHolder);
        },
      },
      {
        name: "pet.show_dialog_toggle",
        title: "Pet Dialog (Toggle)",
        category: "OpenCode Pets",
        run() {
          showDialog(api, "Pet visibility toggled.", timerHolder);
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

const plugin: TuiPluginModule = {
  id: "opencode-pets",
  tui,
};

export default plugin;
