import { z } from "zod";
import { ALL_MOODS } from "./states.js";

const setMoodPayload = z.object({
  mood: z.enum(ALL_MOODS),
});

const showBubblePayload = z.object({
  text: z.string(),
  duration: z.number().positive().optional(),
});

const toggleVisibilityPayload = z.object({});

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
]);

export type IpcMessage = z.infer<typeof IpcMessageSchema>;

export type IpcSetMoodPayload = z.infer<typeof setMoodPayload>;
export type IpcShowBubblePayload = z.infer<typeof showBubblePayload>;
export type IpcToggleVisibilityPayload = z.infer<
  typeof toggleVisibilityPayload
>;

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
