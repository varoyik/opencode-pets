import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getConfigDir } from "@opencode-pets/core";

const THROW_FRICTION = 0.88;
const THROW_STOP_THRESHOLD = 1.2;
const THROW_FRAME_INTERVAL_MS = 16;

const PET_WIDTH = 192;
const PET_HEIGHT = 208;
const WINDOW_WIDTH = 192;
const WINDOW_HEIGHT = 310;
const BOUNCE_RESTITUTION = 0.6;

interface WindowBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function getPrimaryWorkArea(): Electron.Rectangle {
  return screen.getPrimaryDisplay().workArea;
}

function getWindowBoundsForPet(workArea: Electron.Rectangle): WindowBounds {
  // The pet sprite sits at the bottom of the window. Allow the bubble
  // area above the pet to extend past the top edge, but keep the pet
  // itself fully inside the work area.
  return {
    minX: workArea.x,
    maxX: workArea.x + workArea.width - WINDOW_WIDTH,
    minY: workArea.y - (WINDOW_HEIGHT - PET_HEIGHT),
    maxY: workArea.y + workArea.height - WINDOW_HEIGHT,
  };
}

function clampWindowPosition(
  x: number,
  y: number,
  bounds: WindowBounds,
): [number, number] {
  return [
    Math.max(bounds.minX, Math.min(x, bounds.maxX)),
    Math.max(bounds.minY, Math.min(y, bounds.maxY)),
  ];
}

function isPetCompletelyOffScreen(
  x: number,
  y: number,
  workArea: Electron.Rectangle,
): boolean {
  const petLeft = x;
  const petRight = x + PET_WIDTH;
  const petTop = y + (WINDOW_HEIGHT - PET_HEIGHT);
  const petBottom = y + WINDOW_HEIGHT;

  return (
    petRight <= workArea.x ||
    petLeft >= workArea.x + workArea.width ||
    petBottom <= workArea.y ||
    petTop >= workArea.y + workArea.height
  );
}

function getDefaultWindowPosition(
  workArea: Electron.Rectangle,
): [number, number] {
  return [
    workArea.x + workArea.width - WINDOW_WIDTH,
    workArea.y + workArea.height - WINDOW_HEIGHT,
  ];
}

export function createWindow(): BrowserWindow {
  const appPath = app.getAppPath();
  const POSITION_FILE = path.join(getConfigDir(), "position.json");

  const spritesheetPath = path.resolve(
    appPath,
    "assets/pets/claude-crab/spritesheet.webp",
  );

  const preloadPath = path.join(appPath, "dist/preload/bridge.cjs");

  const macOnly = process.platform === "darwin";
  const winOnly = process.platform === "win32";

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
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: "#00000000",
    opacity: winOnly ? 0.9999999 : 1.0,

    // macOS-only
    ...(macOnly && {
      type: "panel" as const,
      hiddenInMissionControl: true,
      enableLargerThanScreen: true,
    }),

    // Windows-only
    ...(winOnly && {
      thickFrame: false,
    }),

    webPreferences: {
      preload: preloadPath,
      additionalArguments: [`--spritesheet-path=${spritesheetPath}`],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setTitle("OpenCode Pets");
  win.webContents.setBackgroundThrottling(false);

  if (process.platform === "win32") {
    // "pop-up-menu" level keeps the window above the taskbar.
    win.setAlwaysOnTop(true, "pop-up-menu");
  }

  win.once("ready-to-show", () => {
    win.show();
    if (macOnly) {
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    } else if (process.platform !== "win32") {
      // Linux (X11/XWayland): preserve visible-on-all-workspaces behavior
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  });

  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  let throwVelocityX = 0;
  let throwVelocityY = 0;
  let throwTimer: ReturnType<typeof setTimeout> | null = null;

  const workArea = getPrimaryWorkArea();
  const bounds = getWindowBoundsForPet(workArea);

  if (existsSync(POSITION_FILE)) {
    try {
      const pos = JSON.parse(readFileSync(POSITION_FILE, "utf-8"));
      if (typeof pos.x === "number" && typeof pos.y === "number") {
        if (isPetCompletelyOffScreen(pos.x, pos.y, workArea)) {
          // Saved position is on a disconnected display — reset to default.
          const [defaultX, defaultY] = getDefaultWindowPosition(workArea);
          win.setPosition(defaultX, defaultY);
          savePositionSoon();
        } else {
          const [clampedX, clampedY] = clampWindowPosition(
            pos.x,
            pos.y,
            bounds,
          );
          win.setPosition(clampedX, clampedY);
          if (clampedX !== pos.x || clampedY !== pos.y) {
            savePositionSoon();
          }
        }
      }
    } catch {
      // Corrupt position file — ignore and use default position
    }
  } else {
    const [defaultX, defaultY] = getDefaultWindowPosition(workArea);
    win.setPosition(defaultX, defaultY);
  }

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
      let nextX = pos[0] + throwVelocityX;
      let nextY = pos[1] + throwVelocityY;

      const wa = getPrimaryWorkArea();
      const b = getWindowBoundsForPet(wa);
      if (nextX < b.minX) {
        nextX = b.minX;
        throwVelocityX = -throwVelocityX * BOUNCE_RESTITUTION;
      } else if (nextX > b.maxX) {
        nextX = b.maxX;
        throwVelocityX = -throwVelocityX * BOUNCE_RESTITUTION;
      }
      if (nextY < b.minY) {
        nextY = b.minY;
        throwVelocityY = -throwVelocityY * BOUNCE_RESTITUTION;
      } else if (nextY > b.maxY) {
        nextY = b.maxY;
        throwVelocityY = -throwVelocityY * BOUNCE_RESTITUTION;
      }

      win.setPosition(Math.round(nextX), Math.round(nextY));

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
    const wa = getPrimaryWorkArea();
    const b = getWindowBoundsForPet(wa);
    const [cx, cy] = clampWindowPosition(pos[0] + dx, pos[1] + dy, b);
    win.setPosition(cx, cy);
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

  function constrainWindowToScreen(): void {
    if (win.isDestroyed() || !win.isVisible()) return;
    const pos = win.getPosition() as [number, number];
    const wa = getPrimaryWorkArea();
    if (isPetCompletelyOffScreen(pos[0], pos[1], wa)) {
      const [defaultX, defaultY] = getDefaultWindowPosition(wa);
      win.setPosition(defaultX, defaultY);
    } else {
      const b = getWindowBoundsForPet(wa);
      const [cx, cy] = clampWindowPosition(pos[0], pos[1], b);
      if (cx !== pos[0] || cy !== pos[1]) {
        win.setPosition(cx, cy);
      }
    }
    savePositionSoon();
  }

  const displayMetricsHandler = (
    _event: Electron.Event,
    _display: Electron.Display,
    changedMetrics: string[],
  ) => {
    if (changedMetrics.includes("workArea")) {
      constrainWindowToScreen();
    }
  };

  screen.on("display-metrics-changed", displayMetricsHandler);

  win.on("close", () => {
    stopThrow();
    screen.removeListener("display-metrics-changed", displayMetricsHandler);
  });

  const rendererPath = path.join(appPath, "dist/renderer/index.html");
  win.loadFile(rendererPath);

  return win;
}
