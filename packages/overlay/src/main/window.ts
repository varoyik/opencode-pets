import { app, BrowserWindow } from "electron";
import path from "node:path";

export function createWindow(): BrowserWindow {
  const appPath = app.getAppPath();

  const spritesheetPath = path.resolve(
    appPath,
    "../../pets/code-companion/spritesheet.webp",
  );

  const preloadPath = path.join(appPath, "dist/preload/bridge.cjs");

  const win = new BrowserWindow({
    width: 192,
    height: 260,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      preload: preloadPath,
      additionalArguments: [`--spritesheet-path=${spritesheetPath}`],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const rendererPath = path.join(appPath, "dist/renderer/index.html");
  win.loadFile(rendererPath);

  return win;
}
