import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";

const POSITION_FILE = path.join(
  os.homedir(),
  ".config",
  "opencode-pets",
  "position.json",
);

export function createWindow(): BrowserWindow {
  const appPath = app.getAppPath();

  const spritesheetPath = path.resolve(
    appPath,
    "assets/pets/claude-crab/spritesheet.webp",
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

  if (existsSync(POSITION_FILE)) {
    try {
      const pos = JSON.parse(readFileSync(POSITION_FILE, "utf-8"));
      if (typeof pos.x === "number" && typeof pos.y === "number") {
        win.setPosition(pos.x, pos.y);
      }
    } catch {
      // Corrupt position file — ignore and use default position
    }
  }

  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  ipcMain.on("drag-delta", (_event, dx: number, dy: number) => {
    const pos = win.getPosition() as [number, number];
    win.setPosition(pos[0] + dx, pos[1] + dy);

    if (writeTimer !== null) {
      clearTimeout(writeTimer);
    }
    writeTimer = setTimeout(() => {
      const newPos = win.getPosition() as [number, number];
      try {
        mkdirSync(path.dirname(POSITION_FILE), { recursive: true });
        writeFileSync(
          POSITION_FILE,
          JSON.stringify({ x: newPos[0], y: newPos[1] }),
        );
      } catch {
        // Best-effort: don't crash if we can't write the position file
      }
      writeTimer = null;
    }, 300);
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const rendererPath = path.join(appPath, "dist/renderer/index.html");
  win.loadFile(rendererPath);

  return win;
}
