export const ALL_MOODS = [
  "idle",
  "thinking",
  "working",
  "waiting",
  "done",
  "error",
] as const;

export type PetMood = (typeof ALL_MOODS)[number];

export interface PetState {
  mood: PetMood;
  previousMood: PetMood;
  /** True when the current mood is temporary (done or error). */
  temporary?: boolean;
  /** Unix-ms timestamp when a temporary mood expires. */
  expiresAt?: number;
  /** Number of active text/reasoning streams. */
  activeStreams: number;
  activeTools: number;
  waitingPermission: boolean;
}

export type PetEvent =
  | { type: "ToolRunning"; toolName?: string }
  | { type: "ToolCompleted" }
  | { type: "StreamStarted" }
  | { type: "StreamEnded" }
  | { type: "SessionCompleted" }
  | { type: "TaskErrored" }
  | { type: "PermissionPrompted"; permissionTitle?: string }
  | { type: "PermissionResolved" }
  | { type: "IdleTimeout" };
