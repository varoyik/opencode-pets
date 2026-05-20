import type { PetMood, PetState, PetEvent } from "./states.js";

const PRIORITY: Record<PetMood, number> = {
  idle: 1,
  thinking: 2,
  working: 3,
  waiting: 4,
  done: 5,
  error: 5,
};

const DONE_DURATION_MS = 3000;
const ERROR_DURATION_MS = 5000;

const EVENT_TO_MOOD: Record<
  Exclude<PetEvent["type"], "PermissionResolved" | "IdleTimeout">,
  PetMood
> = {
  AgentStarted: "working",
  ToolRunning: "working",
  StreamStarted: "thinking",
  StreamEnded: "idle",
  TaskCompleted: "done",
  TaskErrored: "error",
  PermissionPrompted: "waiting",
};

const TEMPORARY_DURATIONS: Partial<Record<PetMood, number>> = {
  done: DONE_DURATION_MS,
  error: ERROR_DURATION_MS,
};

export const INITIAL_STATE: PetState = {
  mood: "idle",
  previousMood: "idle",
};

/**
 * Pure-function pet state reducer.
 *
 * Transitions are governed by priority rules:
 * - Higher-priority states override lower-priority ones
 * - IdleTimeout and StreamEnded can downgrade from thinking/idle to idle
 * - PermissionResolved reverts to the previous mood
 * - Temporary states (done, error) auto-expire after their duration
 */
export function reducer(state: PetState, event: PetEvent): PetState {
  const now = Date.now();

  if (
    state.temporary === true &&
    state.expiresAt !== undefined &&
    now >= state.expiresAt
  ) {
    const reverted: PetState = {
      mood: state.previousMood,
      previousMood: state.mood,
    };
    return reducer(reverted, event);
  }

  if (event.type === "IdleTimeout") {
    if (state.mood === "idle") {
      return state;
    }
    const currentPriority = PRIORITY[state.mood];
    if (currentPriority <= PRIORITY.thinking) {
      return { mood: "idle", previousMood: state.mood };
    }
    return state;
  }

  if (event.type === "PermissionResolved") {
    const fallback: PetMood =
      state.previousMood === state.mood ? "idle" : state.previousMood;
    if (state.mood !== "waiting") {
      return state;
    }
    return {
      mood: fallback,
      previousMood: state.mood,
    };
  }

  const targetMood: PetMood = EVENT_TO_MOOD[event.type];
  const currentPriority = PRIORITY[state.mood];
  const targetPriority = PRIORITY[targetMood];

  if (targetPriority >= currentPriority) {
    return applyTransition(state, targetMood, now);
  }

  if (event.type === "StreamEnded" && currentPriority <= PRIORITY.thinking) {
    return { mood: "idle", previousMood: state.mood };
  }

  return state;
}

function applyTransition(
  state: PetState,
  targetMood: PetMood,
  now: number,
): PetState {
  if (targetMood === state.mood) {
    return state;
  }
  const duration = TEMPORARY_DURATIONS[targetMood];
  if (duration !== undefined) {
    return {
      mood: targetMood,
      previousMood: state.mood,
      temporary: true,
      expiresAt: now + duration,
    };
  }
  return {
    mood: targetMood,
    previousMood: state.mood,
  };
}
