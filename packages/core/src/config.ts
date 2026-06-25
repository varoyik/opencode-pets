import { z } from "zod";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";

/** Structured logger signature used across packages. */
export type LogFn = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) => void;

/**
 * Resolve the OpenCode plugin config directory.
 * Honors `OPENCODE_CONFIG_DIR` as the OpenCode config directory itself,
 * then falls back to `XDG_CONFIG_HOME/opencode`, then platform defaults:
 * - Windows: `%APPDATA%/opencode`
 * - macOS / Linux: `~/.config/opencode`
 */
export function getOpenCodeConfigDir(): string {
  if (process.env["OPENCODE_CONFIG_DIR"]) {
    return process.env["OPENCODE_CONFIG_DIR"];
  }
  return join(getConfigHome(), "opencode");
}

/** Resolve the config home directory, falling through platform defaults. */
function getConfigHome(): string {
  if (process.env["XDG_CONFIG_HOME"]) return process.env["XDG_CONFIG_HOME"];
  if (process.platform === "win32" && process.env["APPDATA"])
    return process.env["APPDATA"];
  return join(homedir(), ".config");
}

/**
 * Resolve the full path to the opencode-pets config file.
 * On macOS / Linux this is `~/.config/opencode/opencode-pets.json`;
 * on Windows it resolves to `%APPDATA%/opencode/opencode-pets.json`.
 */
export function getConfigPath(): string {
  return join(getOpenCodeConfigDir(), "opencode-pets.json");
}

export const PositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

export type Position = z.infer<typeof PositionSchema>;

export const ConfigSchema = z.object({
  /** Pet ID to use on startup (default: "gutsy"). */
  defaultPet: z.string().default("gutsy"),
  /** Idle timeout in milliseconds before pet transitions to idle mood (default: 30000). */
  idleTimeoutMs: z.number().positive().default(30000),
  /** Duration in milliseconds to show speech bubbles before auto-dismiss (default: 5000). */
  bubbleDurationMs: z.number().positive().default(5000),
  /** Last window position persisted by the overlay. */
  position: PositionSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  defaultPet: "gutsy",
  idleTimeoutMs: 30000,
  bubbleDurationMs: 5000,
};

const TEMP_SUFFIX = ".tmp";

/**
 * Read the config file, validate it with Zod, and return the parsed config.
 * If the file does not exist, creates it with default values.
 * If the file is invalid, logs a warning, returns defaults, and writes a fresh default config file.
 */
export function readConfig(log?: LogFn): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    return useDefaults(
      "Config file missing, creating defaults",
      undefined,
      log,
    );
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const result = ConfigSchema.safeParse(parsed);

    if (!result.success) {
      return useDefaults(
        "Invalid config file, using defaults",
        result.error.format(),
        log,
      );
    }

    return result.data;
  } catch (err) {
    return useDefaults("Failed to read config file, using defaults", err, log);
  }
}

/**
 * Write config to disk atomically using temp-file + rename pattern.
 * This ensures that a crash during write does not corrupt the config file.
 */
export function writeConfig(config: Config, log?: LogFn): void {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);
  const tempPath = configPath + TEMP_SUFFIX;

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  try {
    writeFileSync(tempPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    renameSync(tempPath, configPath);
  } catch (err) {
    log?.("error", "Failed to write config file", {
      error: String(err),
    });
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Watch the config file for changes using fs.watch().
 * Calls the callback with the new config whenever the file changes and passes validation.
 * If the config becomes invalid during hot-reload, keeps the previous valid config,
 * logs a warning, and does NOT call the callback with invalid values.
 */
export function watchConfig(
  onChange: (config: Config) => void,
  log?: LogFn,
): () => void {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);
  const configFileName = basename(configPath);
  const tempFileName = configFileName + TEMP_SUFFIX;

  const handleChange = (): void => {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const result = ConfigSchema.safeParse(parsed);

      if (!result.success) {
        log?.(
          "warn",
          "Invalid config during hot-reload, keeping previous valid config",
          { errors: result.error.format() },
        );
        return;
      }

      onChange(result.data);
    } catch (err) {
      log?.("warn", "Failed to read config during hot-reload", {
        error: String(err),
      });
    }
  };

  let watcher: ReturnType<typeof watch> | null = null;

  try {
    // Watch the config directory so atomic renames (temp → final) are reliably
    // reported on Linux. Filter to only react to our own config/temp files.
    watcher = watch(configDir, (eventType, filename) => {
      if (
        (eventType === "change" || eventType === "rename") &&
        (filename === configFileName || filename === tempFileName)
      ) {
        handleChange();
      }
    });
  } catch (err) {
    log?.("warn", "Failed to start config watcher", {
      error: String(err),
    });
    return () => {};
  }

  return () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
}

function useDefaults(reason: string, detail?: unknown, log?: LogFn): Config {
  log?.("warn", reason, { detail });
  writeConfig(DEFAULT_CONFIG, log);
  return DEFAULT_CONFIG;
}
