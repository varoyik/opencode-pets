export { ALL_MOODS } from "./states.js";
export type { PetMood, PetState, PetEvent } from "./states.js";

export { reducer, INITIAL_STATE } from "./reducer.js";

export { IpcMessageSchema, parseIpcMessage } from "./ipc.js";
export type {
  IpcMessage,
  IpcSetMoodPayload,
  IpcShowBubblePayload,
  IpcToggleVisibilityPayload,
  IpcSetConfigPayload,
  IpcSetPetsPayload,
  IpcSwitchPetPayload,
  IpcQuitPetPayload,
  IpcHiddenPayload,
} from "./ipc.js";

export { PetManifestSchema } from "./pets.js";
export type { PetManifest } from "./pets.js";

export { ConfigSchema, getConfigDir, DEFAULT_CONFIG } from "./config.js";
export type { Config } from "./config.js";

export type LogFn = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) => void;
