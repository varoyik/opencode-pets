import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PetManifestSchema } from "@opencode-pets/core";
import type { LogFn, PetManifest } from "@opencode-pets/core";
import { homedir } from "node:os";
import { resolveOverlayPath } from "./overlay-manager.js";

function getBundledPetsDir(): string {
  return join(resolveOverlayPath(), "assets", "pets");
}

function getUserPetsDir(): string {
  return join(homedir(), ".opencode", "pets");
}

function getCodexPetsDir(): string {
  return join(homedir(), ".codex", "pets");
}

interface ScanResult {
  pets: PetManifest[];
  errors: string[];
}

/**
 * Scan a single pets directory for valid pet manifests.
 * Skips directories without pet.json silently.
 * Logs warnings for invalid pet.json or missing spritesheets.
 */
function scanPetsDir(dir: string): ScanResult {
  const pets: PetManifest[] = [];
  const errors: string[] = [];

  if (!existsSync(dir)) {
    return { pets, errors };
  }

  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return { pets, errors };
  }

  for (const entry of entries) {
    const petDir = join(dir, entry);
    const manifestPath = join(petDir, "pet.json");

    if (!existsSync(manifestPath)) {
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(manifestPath, "utf-8");
    } catch {
      errors.push(`Failed to read ${manifestPath}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push(`Invalid JSON in ${manifestPath}`);
      continue;
    }

    const result = PetManifestSchema.safeParse(parsed);
    if (!result.success) {
      errors.push(
        `Invalid pet manifest ${manifestPath}: ${result.error.message}`,
      );
      continue;
    }

    const spritesheetPath = join(petDir, result.data.spritesheetPath);
    if (!existsSync(spritesheetPath)) {
      errors.push(
        `Missing spritesheet for pet "${result.data.id}": ${spritesheetPath}`,
      );
      continue;
    }

    // Store absolute path so the overlay can load it directly
    pets.push({ ...result.data, spritesheetPath });
  }

  return { pets, errors };
}

/**
 * Scan all pet sources and return a deduplicated list.
 * Priority: user OpenCode > user Codex > bundled.
 * Invalid pets are skipped with warning logs.
 */
export function scanPets(log?: LogFn): PetManifest[] {
  const bundledResult = scanPetsDir(getBundledPetsDir());
  const userResult = scanPetsDir(getUserPetsDir());
  const codexResult = scanPetsDir(getCodexPetsDir());

  if (log) {
    for (const result of [bundledResult, userResult, codexResult]) {
      for (const error of result.errors) {
        log("warn", error);
      }
    }
  }

  // Deduplicate by ID with priority: user OpenCode > user Codex > bundled
  const petMap = new Map<string, PetManifest>();
  for (const result of [bundledResult, codexResult, userResult]) {
    for (const pet of result.pets) {
      petMap.set(pet.id, pet);
    }
  }

  return Array.from(petMap.values());
}
