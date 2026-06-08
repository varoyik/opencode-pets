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
