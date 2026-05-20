/** The six pet moods, ordered by priority (lowest to highest). */
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
}

export type PetEvent =
  | { type: "AgentStarted" }
  | { type: "ToolRunning" }
  | { type: "StreamStarted" }
  | { type: "StreamEnded" }
  | { type: "TaskCompleted" }
  | { type: "TaskErrored" }
  | { type: "PermissionPrompted" }
  | { type: "PermissionResolved" }
  | { type: "IdleTimeout" };
