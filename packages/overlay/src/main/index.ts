import { app, ipcMain } from "electron";
import path from "node:path";
import os from "node:os";
import { getSocketPath } from "@opencode-pets/core";
import { createWindow } from "./window.js";
import { createSocketServer } from "./ipc-server.js";
import { ContextMenuManager } from "./context-menu-manager.js";

const SOCKET_PATH = getSocketPath();

function getUserDataDir(): string {
  if (process.platform === "win32") {
    const base = process.env["LOCALAPPDATA"] ?? process.env["APPDATA"];
    if (base) {
      return path.join(base, "opencode-pets");
    }
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "opencode-pets",
    );
  }
  const dataHome = process.env["XDG_DATA_HOME"]
    ? process.env["XDG_DATA_HOME"]
    : path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode-pets");
}

function getSessionDataDir(): string {
  if (process.platform === "win32") {
    const base = process.env["LOCALAPPDATA"] ?? process.env["APPDATA"];
    if (base) {
      return path.join(base, "opencode-pets", "Session Data");
    }
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "opencode-pets");
  }
  const cacheHome = process.env["XDG_CACHE_HOME"]
    ? process.env["XDG_CACHE_HOME"]
    : path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "opencode-pets");
}

let win: ReturnType<typeof createWindow> | null = null;

// Give the window a predictable class so Hyprland rules can match it.
// Note: Electron 42+ derives the actual class from package.json, so
// the Hyprland docs target the effective "opencode-pets-overlay".
app.setName("opencode-pets");

// Keep Chromium/Electron runtime folders (Cache, Local Storage, Crashpad, etc.)
// out of the user's .config directory. Config lives at
// ~/.config/opencode/opencode-pets.json; runtime data goes to platform-appropriate
// data/cache directories.
app.setPath("userData", getUserDataDir());
app.setPath("sessionData", getSessionDataDir());

const gotLock = app.requestSingleInstanceLock();

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
      const menuManager = new ContextMenuManager(win);

      // Wire context menu window lifecycle
      ipcMain.on("open-context-menu", (_event, state) => {
        menuManager.open(state);
      });
      ipcMain.on("close-context-menu", () => {
        menuManager.close();
      });

      const server = createSocketServer(SOCKET_PATH, win);

      await server.start();

      let quitting = false;
      app.on("before-quit", (event) => {
        if (quitting) return; // Re-entry guard
        event.preventDefault();
        quitting = true;
        menuManager.close();
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
