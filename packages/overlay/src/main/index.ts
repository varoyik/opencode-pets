import { app } from "electron";
import { getSocketPath } from "@opencode-pets/core";
import { createWindow } from "./window.js";
import { createSocketServer } from "./ipc-server.js";

const SOCKET_PATH = getSocketPath();

let win: ReturnType<typeof createWindow> | null = null;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (!win.isVisible()) win.show();
      if (win.isMinimized()) win.restore();
    }
  });

  app.dock?.hide();

  app.whenReady().then(async () => {
    win = createWindow();
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
