import type { Subprocess } from "bun";
import os from "node:os";
import path from "node:path";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import type { LogFn } from "@opencode-pets/core";

export function resolveOverlayPath(): string {
  return path.join(os.homedir(), ".opencode-pets", "overlay");
}

function resolveVersionFile(): string {
  return path.join(resolveOverlayPath(), "VERSION");
}

/** Production mode: the VERSION file was written by the auto-downloader. */
function isProductionMode(): boolean {
  return existsSync(resolveVersionFile());
}

function resolveProductionBinary(overlayPath: string): string {
  if (process.platform === "win32") {
    return path.join(overlayPath, "opencode-pets-overlay.exe");
  }
  if (process.platform === "darwin") {
    return path.join(
      overlayPath,
      "opencode-pets-overlay.app",
      "Contents",
      "MacOS",
      "opencode-pets-overlay",
    );
  }
  return path.join(overlayPath, "opencode-pets-overlay");
}

function resolveDevBinary(overlayPath: string): string {
  if (process.platform === "win32") {
    return path.join(
      overlayPath,
      "node_modules",
      "electron",
      "dist",
      "electron.exe",
    );
  }
  return path.join(overlayPath, "node_modules", ".bin", "electron");
}

export function spawnOverlay(): Subprocess {
  const overlayPath = resolveOverlayPath();

  let electronBin: string;
  let args: string[];

  if (isProductionMode()) {
    electronBin = resolveProductionBinary(overlayPath);
    args = []; // Binary itself is the app — no "." needed
  } else {
    electronBin = resolveDevBinary(overlayPath);
    args = ["."]; // Electron runs the overlay directory
  }

  // Native Wayland won't let us self-position or stay on top. Must force X11
  // on the process argv — app.commandLine.appendSwitch is too late for the
  // main process. Works on Hyprland, Sway, river, etc.
  if (
    process.platform === "linux" &&
    process.env["XDG_SESSION_TYPE"] === "wayland"
  ) {
    args.unshift("--ozone-platform=x11");
  }

  return Bun.spawn([electronBin, ...args], {
    cwd: overlayPath,
    stderr: "ignore",
  });
}

export async function healthCheck(socketPath: string): Promise<boolean> {
  const deadline = Date.now() + 15_000; // Electron cold-start can take 5-10s
  while (Date.now() < deadline) {
    try {
      const probe = createConnection({ path: socketPath });
      await new Promise<void>((resolve, reject) => {
        probe.once("connect", () => {
          probe.end();
          resolve();
        });
        probe.once("error", reject);
      });
      return true;
    } catch {
      await Bun.sleep(200);
    }
  }
  return false;
}

export function killOverlay(process: Subprocess, log?: LogFn): void {
  try {
    process.kill();
  } catch (err) {
    log?.("error", "Failed to kill overlay process", {
      error: String(err),
    });
  }
}
