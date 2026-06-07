import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  watch,
} from "node:fs";
import { join } from "node:path";
import {
  ConfigSchema,
  getConfigDir,
  DEFAULT_CONFIG,
} from "@opencode-pets/core";
import type { Config } from "@opencode-pets/core";

const CONFIG_FILENAME = "config.json";
const TEMP_FILENAME = "config.json.tmp";

function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILENAME);
}

/**
 * Read the config file, validate it with Zod, and return the parsed config.
 * If the file does not exist, creates it with default values.
 * If the file is invalid, logs a warning, returns defaults, and writes a fresh default config file.
 */
export function readConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    const configDir = getConfigDir();
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const result = ConfigSchema.safeParse(parsed);

    if (!result.success) {
      console.warn(
        "[config] Invalid config file, using defaults:",
        result.error.format(),
      );
      writeConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }

    return result.data;
  } catch (err) {
    console.warn("[config] Failed to read config file, using defaults:", err);
    writeConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

/**
 * Write config to disk atomically using temp-file + rename pattern.
 * This ensures that a crash during write does not corrupt the config file.
 */
export function writeConfig(config: Config): void {
  const configPath = getConfigPath();
  const tempPath = join(getConfigDir(), TEMP_FILENAME);

  try {
    writeFileSync(tempPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    renameSync(tempPath, configPath);
  } catch (err) {
    console.error("[config] Failed to write config file:", err);
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
 * Watch the config file for changes using Bun.watch() (or fs.watch fallback).
 * Calls the callback with the new config whenever the file changes and passes validation.
 * If the config becomes invalid during hot-reload, keeps the previous valid config,
 * logs a warning, and does NOT call the callback with invalid values.
 */
export function watchConfig(onChange: (config: Config) => void): () => void {
  const configPath = getConfigPath();

  const handleChange = (): void => {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const result = ConfigSchema.safeParse(parsed);

      if (!result.success) {
        console.warn(
          "[config] Invalid config during hot-reload, keeping previous valid config:",
          result.error.format(),
        );
        return;
      }

      onChange(result.data);
    } catch (err) {
      console.warn("[config] Failed to read config during hot-reload:", err);
    }
  };

  let watcher: ReturnType<typeof watch> | null = null;

  try {
    watcher = watch(configPath, (eventType) => {
      if (eventType === "change") {
        handleChange();
      }
    });
  } catch (err) {
    console.warn("[config] Failed to start config watcher:", err);
    return () => {};
  }

  return () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
}
