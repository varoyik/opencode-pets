import os from "node:os";
import path from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { PluginInput } from "@opencode-ai/plugin";
import type { LogFn } from "@opencode-pets/core";
import { resolveOverlayPath } from "./overlay-manager.js";
import pkg from "../package.json" with { type: "json" };

type OpencodeClient = PluginInput["client"];

/**
 * Overlay version this plugin expects. Sourced from the plugin's own
 * package.json version — the overlay release and plugin release are
 * versioned in lockstep, so a mismatch triggers a re-download.
 */
const OVERLAY_VERSION: string = pkg.version;

const OVERLAY_DIR: string = resolveOverlayPath();
const VERSION_FILE: string = path.join(OVERLAY_DIR, "VERSION");
const DEV_ELECTRON_SYMLINK: string = path.join(
  OVERLAY_DIR,
  "node_modules",
  ".bin",
  "electron",
);

const RELEASE_OWNER = "varoyik";
const RELEASE_REPO = "opencode-pets";

type ToastVariant = "info" | "success" | "error";

function detectTarget(): string {
  return `${process.platform}-${process.arch}`;
}

/** `.tar.gz` on macOS/Linux, `.zip` on Windows (tar not universally available). */
function getArchiveExtension(): string {
  return process.platform === "win32" ? "zip" : "tar.gz";
}

function buildDownloadUrl(version: string, target: string): string {
  const ext = getArchiveExtension();
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/v${version}/overlay-${target}.${ext}`;
}

/**
 * Dev mode bypass: setup-dev.sh symlinks Electron into the overlay dir.
 * If that symlink exists, the user is developing from the monorepo and
 * the auto-download must not clobber their setup.
 */
function isDevMode(): boolean {
  return existsSync(DEV_ELECTRON_SYMLINK);
}

function isVersionCurrent(): boolean {
  if (!existsSync(VERSION_FILE)) return false;
  const installed = readFileSync(VERSION_FILE, "utf-8").trim();
  return installed === OVERLAY_VERSION;
}

async function downloadArchive(url: string, tmpFile: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Download failed: HTTP ${response.status} ${response.statusText}`,
    );
  }
  await Bun.write(tmpFile, response);
}

async function extractArchive(tmpFile: string, destDir: string): Promise<void> {
  if (process.platform === "win32") {
    const proc = Bun.spawn(
      [
        "powershell",
        "-Command",
        `Expand-Archive -Path "${tmpFile}" -DestinationPath "${destDir}" -Force`,
      ],
      { stderr: "pipe" },
    );
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(`Extraction failed (exit ${exitCode}): ${stderr}`);
    }
  } else {
    const proc = Bun.spawn(["tar", "-xzf", tmpFile, "-C", destDir], {
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(`Extraction failed (exit ${exitCode}): ${stderr}`);
    }
  }
}

function showToast(
  client: OpencodeClient,
  message: string,
  variant: ToastVariant,
): void {
  client.tui.showToast({ body: { message, variant } }).catch(() => {});
}

/**
 * Ensure the platform-specific overlay binary is installed at
 * `~/.opencode-pets/overlay/`. Skips the download when dev mode is
 * detected (symlinked Electron) or the VERSION file already matches.
 * On failure, logs the error, shows a failure toast, and returns
 * `false` — the caller should proceed without spawning a pet.
 *
 * Never throws: all errors are caught and translated into a `false` return.
 */
export async function ensureOverlayInstalled(
  client: OpencodeClient,
  log: LogFn,
): Promise<boolean> {
  // Dev mode — setup-dev.sh symlinked Electron; skip download entirely.
  if (isDevMode()) {
    log(
      "debug",
      "Dev mode detected (electron symlink present), skipping overlay download",
    );
    return true;
  }

  if (isVersionCurrent()) {
    log("debug", `Overlay version ${OVERLAY_VERSION} already installed`);
    return true;
  }

  const target = detectTarget();
  const ext = getArchiveExtension();
  const url = buildDownloadUrl(OVERLAY_VERSION, target);
  const tmpFile = path.join(
    os.tmpdir(),
    `opencode-pets-overlay-${OVERLAY_VERSION}-${target}.${ext}`,
  );

  showToast(client, "Setting up overlay (one-time download ~60MB)...", "info");
  log("info", `Downloading overlay from ${url}`);

  try {
    mkdirSync(OVERLAY_DIR, { recursive: true });
    await downloadArchive(url, tmpFile);
    log("debug", `Downloaded archive to ${tmpFile}`);

    await extractArchive(tmpFile, OVERLAY_DIR);
    log("debug", `Extracted archive to ${OVERLAY_DIR}`);

    writeFileSync(VERSION_FILE, OVERLAY_VERSION, "utf-8");
    log("info", `Overlay ${OVERLAY_VERSION} installed successfully`);

    showToast(
      client,
      "Overlay ready! Pet will appear when you run /pet",
      "success",
    );
    return true;
  } catch (err) {
    log("error", "Overlay setup failed", { error: String(err) });
    showToast(
      client,
      "Overlay setup failed. Pet disabled. Will retry next session.",
      "error",
    );
    return false;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // File may not exist if download failed before write — ignore.
    }
  }
}
