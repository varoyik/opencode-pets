import { z } from "zod";
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
