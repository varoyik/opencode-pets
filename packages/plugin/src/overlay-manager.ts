import type { Subprocess } from "bun";
import os from "node:os";
import path from "node:path";
import { createConnection } from "node:net";
import type { LogFn } from "@opencode-pets/core";

export function resolveOverlayPath(): string {
  return path.join(os.homedir(), ".opencode-pets", "overlay");
}

export function spawnOverlay(): Subprocess {
  const overlayPath = resolveOverlayPath();

  const electronBin =
    process.platform === "win32"
      ? path.join(
          overlayPath,
          "node_modules",
          "electron",
          "dist",
          "electron.exe",
        )
      : path.join(overlayPath, "node_modules", ".bin", "electron");

  const args = ["."];

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
