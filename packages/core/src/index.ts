export { ALL_MOODS } from "./states.js";
export type { PetMood, PetState, PetEvent } from "./states.js";

export { reducer, INITIAL_STATE } from "./reducer.js";

export { IpcMessageSchema, parseIpcMessage, getSocketPath } from "./ipc.js";
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

export {
  ConfigSchema,
  getConfigPath,
  getOpenCodeConfigDir,
  DEFAULT_CONFIG,
  readConfig,
  writeConfig,
  watchConfig,
} from "./config.js";
export type { Config, Position, LogFn } from "./config.js";
