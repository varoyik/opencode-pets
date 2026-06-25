import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import path from "node:path";

interface PetManifest {
  id: string;
  displayName: string;
  description?: string;
  spritesheetPath: string;
}

interface MenuState {
  bubbleVisible: boolean;
  currentPetId: string;
  pets: PetManifest[];
}

export class ContextMenuManager {
  private menuWindow: BrowserWindow | null = null;
  private initialWidth = 0;
  private initialX = 0;
  private initialY = 0;
  private petWindow: BrowserWindow;

  constructor(petWindow: BrowserWindow) {
    this.petWindow = petWindow;
    // Register action handlers that close the menu before the
    // existing ipc-server.ts handlers process the action.
    // These fire first due to registration order.
    ipcMain.on("hide-pet", () => {
      this.close();
    });

    ipcMain.on("quit-pet", () => {
      this.close();
    });

    ipcMain.on("request-switch-pet", () => {
      this.close();
    });

    ipcMain.on("toggle-bubble", () => {
      this.close();
    });

    // Safety net: close the menu if the pet window is hidden or closed
    // (parent handles auto-close on most platforms, but some WMs may
    // not propagate to transient children).
    if (process.platform === "linux") {
      petWindow.on("hide", () => this.close());
      petWindow.on("close", () => this.close());
    }
  }

  open(state: MenuState): void {
    if (this.menuWindow && !this.menuWindow.isDestroyed()) {
      this.menuWindow.focus();
      return;
    }

    const appPath = app.getAppPath();
    const preloadPath = path.join(appPath, "dist/preload/menu-bridge.cjs");

    this.menuWindow = new BrowserWindow({
      width: 10,
      height: 10,
      transparent: true,
      frame: false,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      backgroundColor: "#00000000",
      // Parent keeps the menu window stacked above the pet (transient
      // windows stay in the parent's layer). On Linux, X11 WMs like
      // Muffin auto-place transients, so we re-apply position after
      // show() to override that.
      parent: this.petWindow,
      webPreferences: {
        preload: preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Linux: safeguard to keep menu above pet (parent handles stacking
    // but always-on-top adds _NET_WM_STATE_ABOVE as extra insurance).
    if (process.platform === "linux") {
      this.menuWindow.setAlwaysOnTop(true, "pop-up-menu");
    }

    // macOS: no special panel behavior needed (menu is a regular floating window)
    if (process.platform === "win32") {
      this.menuWindow.setAlwaysOnTop(true, "pop-up-menu");
    }

    this.menuWindow.setTitle("OpenCode Pets Menu");
    this.menuWindow.webContents.setBackgroundThrottling(false);

    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const workArea = display.workArea;

    this.initialX = Math.max(
      workArea.x,
      Math.min(point.x + 8, workArea.x + workArea.width - 10),
    );
    this.initialY = Math.max(
      workArea.y,
      Math.min(point.y + 8, workArea.y + workArea.height - 10),
    );
    this.initialWidth = 0;

    this.menuWindow.setPosition(
      Math.round(this.initialX),
      Math.round(this.initialY),
    );

    ipcMain.on("menu-ready", () => {
      if (this.menuWindow && !this.menuWindow.isDestroyed()) {
        this.menuWindow.webContents.send("menu-state", state);
      }
    });

    ipcMain.on(
      "menu-size",
      (_event, size: { width: number; height: number }) => {
        if (!this.menuWindow || this.menuWindow.isDestroyed()) return;

        // Store the intended position so we can re-apply it after
        // show() on Linux (X11 WMs override transient window placement).
        let pendingX: number | null = null;
        let pendingY: number | null = null;

        if (this.initialWidth === 0) {
          this.initialWidth = size.width;

          const wa = screen.getDisplayNearestPoint(
            screen.getCursorScreenPoint(),
          ).workArea;
          const menuX = Math.max(
            wa.x,
            Math.min(this.initialX, wa.x + wa.width - size.width),
          );
          const menuY = Math.max(
            wa.y,
            Math.min(this.initialY, wa.y + wa.height - size.height),
          );
          pendingX = Math.round(menuX);
          pendingY = Math.round(menuY);
          this.menuWindow.setPosition(pendingX, pendingY);
        } else if (size.width > this.initialWidth) {
          // Submenu opened — check if we need to flip left
          const [curX, curY] = this.menuWindow.getPosition() as [
            number,
            number,
          ];
          const rightEdge = curX + size.width;
          const wa = screen.getDisplayNearestPoint(
            screen.getCursorScreenPoint(),
          ).workArea;
          if (rightEdge > wa.x + wa.width) {
            const shift = size.width - this.initialWidth;
            const newX = Math.max(wa.x, curX - shift);
            this.menuWindow.setPosition(Math.round(newX), Math.round(curY));
          }
        }

        this.menuWindow.setBounds({ width: size.width, height: size.height });
        this.menuWindow.show();

        // On Linux, X11 WMs like Muffin auto-center transient windows
        // over their parent when first mapped (show()). Re-apply our
        // cursor-based position after show() to override that placement.
        if (
          process.platform === "linux" &&
          pendingX !== null &&
          pendingY !== null
        ) {
          this.menuWindow.setPosition(pendingX, pendingY);
        }
      },
    );

    // Register Escape via globalShortcut — the menu window is
    // focusable: false so it cannot receive keyboard events through
    // normal Electron channels (before-input-event, keydown, etc.).
    // globalShortcut works on X11 and XWayland; we register it only
    // while the menu is visible and unregister on close.
    if (!globalShortcut.register("Escape", () => this.close())) {
      // Registration can fail if another app holds the grab — menu
      // will simply not close on Escape, which is acceptable.
    }

    this.menuWindow.on("closed", () => {
      this.cleanup();
      this.menuWindow = null;
    });

    const rendererPath = path.join(appPath, "dist/renderer/context-menu.html");
    this.menuWindow.loadFile(rendererPath);
  }

  close(): void {
    if (this.menuWindow && !this.menuWindow.isDestroyed()) {
      this.menuWindow.close();
    } else {
      this.cleanup();
    }
  }

  isOpen(): boolean {
    return this.menuWindow !== null && !this.menuWindow.isDestroyed();
  }

  private cleanup(): void {
    if (globalShortcut.isRegistered("Escape")) {
      globalShortcut.unregister("Escape");
    }
    this.menuWindow = null;
    this.initialWidth = 0;
    ipcMain.removeAllListeners("menu-ready");
    ipcMain.removeAllListeners("menu-size");
  }
}
