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

const THROW_FRICTION = 0.88;
const THROW_STOP_THRESHOLD = 1.2;
const THROW_FRAME_INTERVAL_MS = 16;

export function createWindow(): BrowserWindow {
  const appPath = app.getAppPath();

  const spritesheetPath = path.resolve(
    appPath,
    "assets/pets/claude-crab/spritesheet.webp",
  );

  const preloadPath = path.join(appPath, "dist/preload/bridge.cjs");

  const win = new BrowserWindow({
    width: 192,
    height: 310,
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

  win.webContents.setBackgroundThrottling(false);

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
  let throwVelocityX = 0;
  let throwVelocityY = 0;
  let throwTimer: ReturnType<typeof setTimeout> | null = null;

  function savePositionSoon(): void {
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
  }

  function stopThrow(): void {
    if (throwTimer !== null) {
      clearTimeout(throwTimer);
      throwTimer = null;
    }
    throwVelocityX = 0;
    throwVelocityY = 0;
  }

  function scheduleThrowFrame(): void {
    throwTimer = setTimeout(() => {
      throwVelocityX *= THROW_FRICTION;
      throwVelocityY *= THROW_FRICTION;

      const pos = win.getPosition() as [number, number];
      win.setPosition(
        Math.round(pos[0] + throwVelocityX),
        Math.round(pos[1] + throwVelocityY),
      );

      savePositionSoon();

      const speed = Math.hypot(throwVelocityX, throwVelocityY);
      if (speed < THROW_STOP_THRESHOLD) {
        throwTimer = null;
        win.webContents.send("throw-end");
      } else {
        scheduleThrowFrame();
      }
    }, THROW_FRAME_INTERVAL_MS);
  }

  ipcMain.on("drag-delta", (_event, dx: number, dy: number) => {
    stopThrow();
    const pos = win.getPosition() as [number, number];
    win.setPosition(pos[0] + dx, pos[1] + dy);
    savePositionSoon();
  });

  ipcMain.on("drag-end", (_event, vx: number, vy: number) => {
    stopThrow();
    throwVelocityX = vx;
    throwVelocityY = vy;
    const speed = Math.hypot(vx, vy);
    if (speed < THROW_STOP_THRESHOLD) {
      win.webContents.send("throw-end");
      return;
    }
    scheduleThrowFrame();
  });

  win.on("close", () => {
    stopThrow();
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const rendererPath = path.join(appPath, "dist/renderer/index.html");
  win.loadFile(rendererPath);

  return win;
}
