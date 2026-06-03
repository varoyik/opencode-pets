import type { PetMood, PetState, PetEvent } from "./states.js";

const DONE_DURATION_MS = 3000;
const ERROR_DURATION_MS = 5000;

export const INITIAL_STATE: PetState = {
  mood: "idle",
  previousMood: "idle",
  activeStreams: 0,
  activeTools: 0,
  waitingPermission: false,
};

/**
 * Derive the base mood from context counters.
 * Ordered: permission > tools > streams > idle
 */
function deriveMood(
  state: Pick<PetState, "activeStreams" | "activeTools" | "waitingPermission">,
): PetMood {
  if (state.waitingPermission) return "waiting";
  if (state.activeTools > 0) return "working";
  if (state.activeStreams > 0) return "thinking";
  return "idle";
}

/**
 * Pure-function pet state reducer.
 *
 * Derives mood from active session context:
 * - waitingPermission → waiting
 * - activeTools > 0 → working
 * - activeStreams > 0 → thinking
 * - else → idle
 *
 * Temporary states (done, error) override the derived mood while active.
 * Counter changes are applied first, then mood is re-derived.
 */
export function reducer(state: PetState, event: PetEvent): PetState {
  const now = Date.now();

  if (
    state.temporary === true &&
    state.expiresAt !== undefined &&
    now >= state.expiresAt
  ) {
    const derived = deriveMood(state);
    const { temporary: _tmp, expiresAt: _exp, ...rest } = state;
    const reverted: PetState = {
      ...rest,
      mood: derived,
      previousMood: state.mood,
    };
    return reducer(reverted, event);
  }

  // IdleTimeout: only transition to idle when all counters are zero
  // and no temporary state is active
  if (event.type === "IdleTimeout") {
    if (state.temporary) {
      return state;
    }
    if (
      state.activeStreams === 0 &&
      state.activeTools === 0 &&
      !state.waitingPermission
    ) {
      if (state.mood === "idle") return state;
      return {
        ...state,
        mood: "idle",
        previousMood: state.mood,
      };
    }
    return state;
  }

  let nextState = { ...state };

  switch (event.type) {
    case "StreamStarted":
      nextState.activeStreams += 1;
      break;
    case "StreamEnded":
      nextState.activeStreams = Math.max(0, nextState.activeStreams - 1);
      break;
    case "ToolRunning":
      nextState.activeTools += 1;
      break;
    case "ToolCompleted":
      nextState.activeTools = Math.max(0, nextState.activeTools - 1);
      break;
    case "PermissionPrompted":
      nextState.waitingPermission = true;
      break;
    case "PermissionResolved":
      nextState.waitingPermission = false;
      break;
    case "SessionCompleted":
      nextState.activeStreams = 0;
      nextState.activeTools = 0;
      nextState.waitingPermission = false;
      break;
    case "TaskErrored":
      nextState.activeStreams = 0;
      nextState.activeTools = 0;
      nextState.waitingPermission = false;
      break;
  }

  const derivedMood = deriveMood(nextState);

  if (event.type === "SessionCompleted") {
    // Don't override an active error state with done.
    // session.idle often fires even after session.error.
    if (state.mood === "error") {
      return nextState;
    }
    return {
      ...nextState,
      mood: "done",
      previousMood: state.mood,
      temporary: true,
      expiresAt: now + DONE_DURATION_MS,
    };
  }

  if (event.type === "TaskErrored") {
    return {
      ...nextState,
      mood: "error",
      previousMood: state.mood,
      temporary: true,
      expiresAt: now + ERROR_DURATION_MS,
    };
  }

  // For all other events, set mood to derived mood
  // (temporary states are still active if they haven't expired — handled above)
  if (state.temporary) {
    // While temporary is active, keep the temporary mood but update counters
    // The expiry check at the top will revert when time is up
    if (nextState.mood !== state.mood) {
      nextState.previousMood = state.mood;
    }
    return nextState;
  }

  if (derivedMood !== state.mood) {
    nextState.mood = derivedMood;
    nextState.previousMood = state.mood;
  }

  return nextState;
}
