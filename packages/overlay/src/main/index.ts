import { app } from "electron";
import { createWindow } from "./window.js";
import { createSocketServer } from "./ipc-server.js";

const SOCKET_PATH = `/tmp/opencode-pets-${process.getuid?.() ?? "0"}/opencode-pets.sock`;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Secondary instance already quit via !gotLock above.
  });

  app.dock?.hide();

  app.whenReady().then(async () => {
    const win = createWindow();
    const server = createSocketServer(SOCKET_PATH, win);

    await server.start();

    let quitting = false;
    app.on("before-quit", (event) => {
      if (quitting) return; // Re-entry guard
      event.preventDefault();
      quitting = true;
      server.stop().finally(() => app.quit());
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
