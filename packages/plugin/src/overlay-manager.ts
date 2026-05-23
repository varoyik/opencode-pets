import type { Subprocess } from "bun";
import os from "node:os";
import path from "node:path";

export function resolveOverlayPath(): string {
  return path.join(os.homedir(), ".opencode-pets", "overlay");
}

export function spawnOverlay(): Subprocess {
  const overlayPath = resolveOverlayPath();
  return Bun.spawn(["npx", "electron", "."], { cwd: overlayPath });
}

export async function healthCheck(socketPath: string): Promise<boolean> {
  const deadline = Date.now() + 5000;
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
): Promise<Subprocess | undefined> {
  try {
    const proc = spawnOverlay();
    const ready = await healthCheck(socketPath);
    if (!ready) {
      console.error("[overlay-manager] overlay health check timed out");
      killOverlay(proc);
      return undefined;
    }
    return proc;
  } catch (err) {
    console.error("[overlay-manager] failed to start overlay:", err);
    return undefined;
  }
}
