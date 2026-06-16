import { app } from "electron";
import { getSocketPath } from "@opencode-pets/core";
import { createWindow } from "./window.js";
import { createSocketServer } from "./ipc-server.js";

const SOCKET_PATH = getSocketPath();

let win: ReturnType<typeof createWindow> | null = null;

// Give the window a predictable class so Hyprland rules can match it.
// Note: Electron 42+ derives the actual class from package.json, so
// the Hyprland docs target the effective "opencode-pets-overlay".
app.setName("opencode-pets");

// Native Wayland bans the window controls we need (self-positioning,
// always-on-top, workspace pinning). Force X11 under XWayland. The plugin
// injects --ozone-platform=x11 when spawning; we also set it here so
// Electron forwards it to child processes (renderer, GPU).
if (
  process.platform === "linux" &&
  process.env["XDG_SESSION_TYPE"] === "wayland"
) {
  app.commandLine.appendSwitch("ozone-platform", "x11");
}

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
    const create = async () => {
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
    };

    // On Linux, creating the transparent window too early can leave a black
    // background. Brief delay lets the X11/XWayland compositor settle.
    if (process.platform === "linux") {
      setTimeout(create, 400);
    } else {
      await create();
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
