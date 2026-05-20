import { app, ipcMain } from "electron";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPetWindow, pinOnHyprland } from "./window.js";

// --- Linux / Wayland compatibility ---
// Must be called before app.whenReady().
if (process.platform === "linux") {
  // Required for transparent windows on Linux (Chromium flag).
  app.commandLine.appendSwitch("enable-transparent-visuals");
  // Software rendering — most reliable for small transparent overlays on Wayland.
  // Avoids Vulkan init errors and GPU-compositing glitches.
  app.disableHardwareAcceleration();
}

// Single-instance lock — exit immediately if another instance is running.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// macOS: hide the dock icon since this is an overlay, not a normal app.
app.dock?.hide();

// Set app name for window class (WM_CLASS) identification.
// Used by Hyprland window rules: windowrulev2 = pin, class:^(opencode-pets)$
app.setName("opencode-pets");

// IPC: spritesheet path — computed in main process (sandboxed preload can't use node:path).
ipcMain.handle("get-spritesheet-path", () => {
  const spritesheetPath = resolve(
    app.getAppPath(),
    "..",
    "..",
    "pets",
    "code-companion",
    "spritesheet.webp",
  );
  return pathToFileURL(spritesheetPath).href;
});

app.whenReady().then(() => {
  const rendererPath = join(app.getAppPath(), "src", "renderer", "index.html");
  const win = createPetWindow();
  win.loadFile(rendererPath);

  // Delay showing until transparent visuals are fully initialised.
  // Without this, the window renders blank on Wayland.
  win.once("ready-to-show", () => {
    setTimeout(() => {
      win.show();
      pinOnHyprland(win);
    }, 100);
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
