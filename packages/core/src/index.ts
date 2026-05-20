export { ALL_MOODS } from "./states.js";
export type { PetMood, PetState, PetEvent } from "./states.js";

export { reducer, INITIAL_STATE } from "./reducer.js";

export { IpcMessageSchema, parseIpcMessage } from "./ipc.js";
export type {
  IpcMessage,
  IpcSetMoodPayload,
  IpcShowBubblePayload,
  IpcToggleVisibilityPayload,
} from "./ipc.js";
