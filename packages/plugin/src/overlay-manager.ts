import type { Subprocess } from "bun";
import os from "node:os";
import path from "node:path";

export function resolveOverlayPath(): string {
  return path.join(os.homedir(), ".opencode-pets", "overlay");
}

export function spawnOverlay(): Subprocess {
  const overlayPath = resolveOverlayPath();
  const electronBin = path.join(
    overlayPath,
    "node_modules",
    ".bin",
    "electron",
  );
  return Bun.spawn([electronBin, "."], { cwd: overlayPath, stderr: "ignore" });
}

export async function healthCheck(socketPath: string): Promise<boolean> {
  const deadline = Date.now() + 15_000; // Electron cold-start can take 5-10s
  while (Date.now() < deadline) {
    if (await Bun.file(socketPath).exists()) return true;
    await Bun.sleep(200);
  }
  return false;
}

export function killOverlay(process: Subprocess): void {
  try {
    process.kill();
  } catch (err) {
    console.error("[overlay-manager] failed to kill overlay process:", err);
  }
}

export async function startOverlay(
  socketPath: string,
  overlayQuitting = false,
): Promise<Subprocess | undefined> {
  if (overlayQuitting) {
    // Overlay was intentionally quit — do not auto-respawn.
    return undefined;
  }
  try {
    const proc = spawnOverlay();
    const ready = await healthCheck(socketPath);
    if (!ready) {
      // Don't kill — the IpcClient has exponential-backoff reconnection.
      // If Electron cold-started slowly, the socket will appear shortly.
      // If the process truly crashed, it exits on its own.
      console.warn(
        "[overlay-manager] overlay health check timed out — " +
          "IPC client will retry connecting automatically.",
      );
    }
    return proc;
  } catch (err) {
    console.error("[overlay-manager] failed to start overlay:", err);
    return undefined;
  }
}

/**
 * Respawn the overlay after it was intentionally quit.
 * Callers must reset the IpcClient quitting state before calling this.
 */
export async function respawnOverlay(
  socketPath: string,
): Promise<Subprocess | undefined> {
  return startOverlay(socketPath, false);
}
