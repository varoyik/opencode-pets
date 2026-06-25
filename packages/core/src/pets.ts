import { z } from "zod";

export const PetManifestSchema = z.object({
  /** Unique pet identifier (e.g. "claude-crab"). */
  id: z.string(),
  /** Human-readable name shown in the pet selector. */
  displayName: z.string(),
  description: z.string().optional(),
  /** Filename of the spritesheet relative to the pet directory (e.g. "spritesheet.webp"). */
  spritesheetPath: z.string(),
});

export type PetManifest = z.infer<typeof PetManifestSchema>;
