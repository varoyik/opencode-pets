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

/** Overlay version — lockstepped with plugin package.json. */
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

/** Dev mode — symlinked Electron detected; skip download. */
function isDevMode(): boolean {
  if (process.platform === "win32") {
    return existsSync(
      path.join(
        OVERLAY_DIR,
        "node_modules",
        "electron",
        "dist",
        "electron.exe",
      ),
    );
  }
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
  // Bun.write streaming deadlocks on stall (#16808, #21455, #30594) — use arrayBuffer().
  const buffer = await response.arrayBuffer();
  await Bun.write(tmpFile, new Uint8Array(buffer));
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
    const timeout = Bun.sleep(120_000).then(() => {
      proc.kill();
      throw new Error("Extraction timed out after 120s");
    });
    const [exitCode, stderr] = await Promise.race([
      Promise.all([proc.exited, new Response(proc.stderr).text()]),
      timeout,
    ]);
    if (exitCode !== 0) {
      throw new Error(`Extraction failed (exit ${exitCode}): ${stderr}`);
    }
  } else {
    const proc = Bun.spawn(["tar", "-xzf", tmpFile, "-C", destDir], {
      stderr: "pipe",
    });
    const timeout = Bun.sleep(120_000).then(() => {
      proc.kill();
      throw new Error("Extraction timed out after 120s");
    });
    const [exitCode, stderr] = await Promise.race([
      Promise.all([proc.exited, new Response(proc.stderr).text()]),
      timeout,
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

/** Ensure overlay binary is installed. Never throws — returns false on failure. */
export async function ensureOverlayInstalled(
  client: OpencodeClient,
  log: LogFn,
): Promise<boolean> {
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

  log("info", `Downloading overlay from ${url}`);

  try {
    mkdirSync(OVERLAY_DIR, { recursive: true });
    await downloadArchive(url, tmpFile);
    log("debug", `Downloaded archive to ${tmpFile}`);

    await extractArchive(tmpFile, OVERLAY_DIR);
    log("debug", `Extracted archive to ${OVERLAY_DIR}`);

    writeFileSync(VERSION_FILE, OVERLAY_VERSION, "utf-8");
    log("info", `Overlay ${OVERLAY_VERSION} installed successfully`);
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
