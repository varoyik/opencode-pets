import { reducer, INITIAL_STATE } from "@opencode-pets/core";
import type { PetMood, PetState, PetEvent } from "@opencode-pets/core";

const IDLE_TIMEOUT_MS = 30_000;

export const SSE_EVENT_TO_PET_EVENT: Record<string, PetEvent["type"]> = {
  "tool.execute.before": "ToolRunning",
  "tool.execute.after": "TaskCompleted",
  "session.next.text.started": "StreamStarted",
  "session.next.reasoning.started": "StreamStarted",
  "session.next.text.ended": "StreamEnded",
  "session.next.reasoning.ended": "StreamEnded",
  "permission.asked": "PermissionPrompted",
  "permission.replied": "PermissionResolved",
  "session.error": "TaskErrored",
  "session.next.tool.failed": "TaskErrored",
  "session.idle": "IdleTimeout",
};

export const RELEVANT_EVENT_TYPES: ReadonlySet<string> = new Set(
  Object.keys(SSE_EVENT_TO_PET_EVENT),
);

/**
 * Minimal interface for the IPC client — anything with `sendMood()` works.
 * Uses duck-typing to keep the state-deriver decoupled from IpcClient.
 */
interface IpcClientLike {
  sendMood(mood: PetMood): void;
}

export class StateDeriver {
  private state: PetState;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ipcClient: IpcClientLike;

  constructor(ipcClient: IpcClientLike) {
    this.ipcClient = ipcClient;
    this.state = { ...INITIAL_STATE };
    this.resetIdleTimer();
  }

  handleEvent(event: PetEvent): void {
    const newState = reducer(this.state, event);

    if (newState.mood !== this.state.mood) {
      this.ipcClient.sendMood(newState.mood);
    }

    this.state = newState;

    // Only activity events reset the timer — not the timeout firing.
    if (event.type !== "IdleTimeout") {
      this.resetIdleTimer();
    }
  }

  dispose(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.handleEvent({ type: "IdleTimeout" });
    }, IDLE_TIMEOUT_MS);
  }
}
