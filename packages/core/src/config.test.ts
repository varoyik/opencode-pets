import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getOpenCodeConfigDir,
  getConfigPath,
  readConfig,
  writeConfig,
  watchConfig,
  DEFAULT_CONFIG,
} from "./config.js";

function createTempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-pets-config-"));
  process.env["OPENCODE_CONFIG_DIR"] = dir;
  return dir;
}

describe("config path resolution", () => {
  const originalEnv = process.env["OPENCODE_CONFIG_DIR"];
  const originalXdg = process.env["XDG_CONFIG_HOME"];

  beforeEach(() => {
    delete process.env["OPENCODE_CONFIG_DIR"];
    delete process.env["XDG_CONFIG_HOME"];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["OPENCODE_CONFIG_DIR"];
    } else {
      process.env["OPENCODE_CONFIG_DIR"] = originalEnv;
    }
    if (originalXdg === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = originalXdg;
    }
  });

  it("uses OPENCODE_CONFIG_DIR when set", () => {
    process.env["OPENCODE_CONFIG_DIR"] = "/custom/opencode";
    expect(getOpenCodeConfigDir()).toBe("/custom/opencode");
    expect(getConfigPath()).toBe("/custom/opencode/opencode-pets.json");
  });

  it("falls back to XDG_CONFIG_HOME/opencode", () => {
    process.env["XDG_CONFIG_HOME"] = "/xdg/config";
    expect(getOpenCodeConfigDir()).toBe("/xdg/config/opencode");
  });

  it("prefers OPENCODE_CONFIG_DIR over XDG_CONFIG_HOME", () => {
    process.env["OPENCODE_CONFIG_DIR"] = "/custom/opencode";
    process.env["XDG_CONFIG_HOME"] = "/xdg/config";
    expect(getOpenCodeConfigDir()).toBe("/custom/opencode");
  });
});

describe("config read/write", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = createTempConfigDir();
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env["OPENCODE_CONFIG_DIR"];
  });

  it("creates default config when file is missing", () => {
    const config = readConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(existsSync(getConfigPath())).toBe(true);
    const raw = JSON.parse(readFileSync(getConfigPath(), "utf-8"));
    expect(raw.defaultPet).toBe("gutsy");
    expect(raw.position).toBeUndefined();
  });

  it("reads an existing config file", () => {
    const expected = {
      defaultPet: "gutsy",
      idleTimeoutMs: 15000,
      bubbleDurationMs: 3000,
    };
    mkdirSync(configDir, { recursive: true });
    writeConfig(expected);

    const config = readConfig();
    expect(config).toEqual({ ...expected, position: undefined });
  });

  it("preserves position when present", () => {
    const config = {
      defaultPet: "gutsy",
      idleTimeoutMs: 15000,
      bubbleDurationMs: 3000,
      position: { x: 42, y: 99 },
    };
    writeConfig(config);
    expect(readConfig()).toEqual(config);
  });

  it("falls back to defaults and rewrites file for invalid JSON", () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(getConfigPath(), "not json");

    const config = readConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
    const raw = JSON.parse(readFileSync(getConfigPath(), "utf-8"));
    expect(raw.defaultPet).toBe(DEFAULT_CONFIG.defaultPet);
  });

  it("falls back to defaults and rewrites file for schema failures", () => {
    writeConfig({
      defaultPet: "gutsy",
      idleTimeoutMs: -1,
      bubbleDurationMs: 3000,
    });

    const config = readConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("watches config file changes", async () => {
    readConfig();
    let received = DEFAULT_CONFIG;
    const stop = watchConfig((config) => {
      received = config;
    });

    writeConfig({
      defaultPet: "nezukocoder",
      idleTimeoutMs: 60000,
      bubbleDurationMs: 10000,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received.defaultPet).toBe("nezukocoder");
    stop();
  });
});
