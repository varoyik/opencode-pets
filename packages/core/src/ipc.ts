import { z } from "zod";
import { userInfo } from "node:os";
import { ALL_MOODS } from "./states.js";
import { PetManifestSchema } from "./pets.js";

const setMoodPayload = z.object({
  mood: z.enum(ALL_MOODS),
});

const showBubblePayload = z.object({
  text: z.string(),
  duration: z.number().positive().optional(),
});

const toggleVisibilityPayload = z.object({});

const setConfigPayload = z.object({
  defaultPet: z.string(),
  idleTimeoutMs: z.number().positive(),
  bubbleDurationMs: z.number().positive(),
});

const setPetsPayload = z.object({
  pets: z.array(PetManifestSchema),
});

const switchPetPayload = z.object({
  petId: z.string(),
  spritesheetPath: z.string().optional(),
});

const quitPetPayload = z.object({});

const hiddenPayload = z.object({});

export const IpcMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_mood"),
    payload: setMoodPayload,
  }),
  z.object({
    type: z.literal("show_bubble"),
    payload: showBubblePayload,
  }),
  z.object({
    type: z.literal("toggle_visibility"),
    payload: toggleVisibilityPayload,
  }),
  z.object({
    type: z.literal("set_config"),
    payload: setConfigPayload,
  }),
  z.object({
    type: z.literal("set_pets"),
    payload: setPetsPayload,
  }),
  z.object({
    type: z.literal("switch_pet"),
    payload: switchPetPayload,
  }),
  z.object({
    type: z.literal("quit_pet"),
    payload: quitPetPayload,
  }),
  z.object({
    type: z.literal("hidden"),
    payload: hiddenPayload,
  }),
]);

export type IpcMessage = z.infer<typeof IpcMessageSchema>;

export type IpcSetMoodPayload = z.infer<typeof setMoodPayload>;
export type IpcShowBubblePayload = z.infer<typeof showBubblePayload>;
export type IpcToggleVisibilityPayload = z.infer<
  typeof toggleVisibilityPayload
>;
export type IpcSetConfigPayload = z.infer<typeof setConfigPayload>;
export type IpcSetPetsPayload = z.infer<typeof setPetsPayload>;
export type IpcSwitchPetPayload = z.infer<typeof switchPetPayload>;
export type IpcQuitPetPayload = z.infer<typeof quitPetPayload>;
export type IpcHiddenPayload = z.infer<typeof hiddenPayload>;

/**
 * Safely parse and validate an IPC message from JSON.
 * Returns the parsed message or null if validation fails.
 */
export function parseIpcMessage(raw: unknown): IpcMessage | null {
  const result = IpcMessageSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Return the platform-specific IPC endpoint path.
 * - Linux / macOS: Unix domain socket under /tmp.
 * - Windows: named pipe under \\.\pipe\.
 */
export function getSocketPath(): string {
  const suffix = getSocketSuffix();
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\opencode-pets-${suffix}`;
  }
  return `/tmp/opencode-pets-${suffix}/opencode-pets.sock`;
}

function getSocketSuffix(): string {
  try {
    if (process.platform === "win32") {
      return userInfo()
        .username.toLowerCase()
        .replace(/[^a-z0-9]/g, "-");
    }
    return String(userInfo().uid);
  } catch {
    return "default";
  }
}
