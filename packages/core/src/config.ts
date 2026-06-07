import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the cross-platform config directory for opencode-pets.
 * - macOS / Linux: `~/.config/opencode-pets/`
 * - Windows: `%APPDATA%/opencode-pets/`
 */
export function getConfigDir(): string {
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    if (!appData) {
      throw new Error("APPDATA environment variable is not set");
    }
    return join(appData, "opencode-pets");
  }
  return join(homedir(), ".config", "opencode-pets");
}

export const ConfigSchema = z.object({
  /** Pet ID to use on startup (default: "claude-crab"). */
  defaultPet: z.string().default("claude-crab"),
  /** Idle timeout in milliseconds before pet transitions to idle mood (default: 30000). */
  idleTimeoutMs: z.number().positive().default(30000),
  /** Duration in milliseconds to show speech bubbles before auto-dismiss (default: 5000). */
  bubbleDurationMs: z.number().positive().default(5000),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Hardcoded defaults used when config file is missing or invalid. */
export const DEFAULT_CONFIG: Config = {
  defaultPet: "claude-crab",
  idleTimeoutMs: 30000,
  bubbleDurationMs: 5000,
};
