import { BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Detect Hyprland compositor via its instance signature env var. */
function isHyprland(): boolean {
  return !!process.env["HYPRLAND_INSTANCE_SIGNATURE"];
}

/**
 * Pin the overlay window on Hyprland.
 *
 * Wayland has no protocol for "always on top" or "visible on all workspaces"
 * (confirmed by Electron docs PR #50560). On Hyprland the `pin` dispatcher
 * handles both — but it only works on floating windows, so we float first.
 *
 * If hyprctl is unavailable the user must add window rules to hyprland.conf:
 *   windowrulev2 = float, class:^(opencode-pets)$
 *   windowrulev2 = pin,  class:^(opencode-pets)$
 */
export function pinOnHyprland(win: BrowserWindow): void {
  if (!isHyprland()) return;

  try {
    const raw = execFileSync("hyprctl", ["clients", "-j"], {
      encoding: "utf-8",
      timeout: 2000,
    });

    const clients = JSON.parse(raw) as Array<{
      address: string;
      title: string;
      floating: boolean;
    }>;

    const ourWindow = clients.find((c) => c.title === win.getTitle());
    if (!ourWindow) return;

    // pin only works on floating windows
    if (!ourWindow.floating) {
      execFileSync("hyprctl", [
        "dispatch",
        "togglefloating",
        `address:${ourWindow.address}`,
      ]);
    }

    // pin = always-on-top + visible on all workspaces
    execFileSync("hyprctl", [
      "dispatch",
      "pin",
      `address:${ourWindow.address}`,
    ]);
  } catch {
    // hyprctl not found or command failed — user should add window rules instead.
  }
}

export function createPetWindow(): BrowserWindow {
  const preloadPath = join(__dirname, "..", "preload", "bridge.js");

  const win = new BrowserWindow({
    width: 192,
    height: 260,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    show: false, // shown after ready-to-show + delay (see index.ts)
    title: "opencode-pets",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  // Pass all mouse events through to windows below — pet never steals focus.
  // Avoids focusable: false, which causes Linux WMs to hide the window during fullscreen.
  win.setIgnoreMouseEvents(true, { forward: true });

  // macOS: highest stacking level above fullscreen and across Spaces
  if (process.platform === "darwin") {
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    // Linux/Windows: best-effort (Wayland requires hyprctl pin — see pinOnHyprland)
    win.setAlwaysOnTop(true);
    win.setVisibleOnAllWorkspaces(true);
  }

  return win;
}
