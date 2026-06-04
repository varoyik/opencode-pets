import { reducer, INITIAL_STATE } from "@opencode-pets/core";
import type { PetMood, PetState, PetEvent } from "@opencode-pets/core";

const IDLE_TIMEOUT_MS = 30_000;

/**
 * Structural subset of the SDK's v1 Event type — only the fields we need.
 * Uses `properties: unknown` because each event member has a different
 * properties shape, and we cast to the shape we need in the handler.
 */
interface SdkEvent {
  type: string;
  properties: unknown;
}

interface PartUpdatedProps {
  part: { id: string; type: string };
}

interface PartRemovedProps {
  partID: string;
}

/**
 * Minimal interface for the IPC client — anything with `sendMood()` works.
 * Uses duck-typing to keep the state-deriver decoupled from IpcClient.
 */
interface IpcClientLike {
  sendMood(mood: PetMood): void;
}

/** Part types that indicate the agent is actively generating a response. */
const STREAM_PART_TYPES = new Set(["text", "reasoning", "step-start"]);

export class StateDeriver {
  private state: PetState;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ipcClient: IpcClientLike;
  private activeStreamParts = new Set<string>();
  private hasError = false;

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

    // Schedule or clear temporary-state expiry timer
    this.manageExpiryTimer();
  }

  handleSseEvent(event: SdkEvent): void {
    switch (event.type) {
      case "message.part.updated": {
        const { part } = event.properties as PartUpdatedProps;

        if (!STREAM_PART_TYPES.has(part.type)) {
          return;
        }

        // Fire StreamStarted on the FIRST message.part.updated for this part ID.
        // We do NOT use delta to decide — in some OpenCode setups delta is always
        // undefined, which caused StreamStarted and StreamEnded to fire in the
        // same tick, cancelling each other out.
        if (!this.activeStreamParts.has(part.id)) {
          this.activeStreamParts.add(part.id);
          this.handleEvent({ type: "StreamStarted" });
        }
        break;
      }

      case "message.part.removed": {
        const { partID } = event.properties as PartRemovedProps;
        if (this.activeStreamParts.has(partID)) {
          this.activeStreamParts.delete(partID);
          if (this.activeStreamParts.size === 0) {
            this.handleEvent({ type: "StreamEnded" });
          }
        }
        break;
      }

      case "permission.asked":
        this.handleEvent({ type: "PermissionPrompted" });
        break;

      case "permission.replied":
        this.handleEvent({ type: "PermissionResolved" });
        break;

      case "session.error":
        console.log(
          "[state-deriver] session.error received — triggering error mood",
        );
        this.hasError = true;
        this.resetSessionState();
        this.handleEvent({ type: "TaskErrored" });
        break;

      case "session.idle": {
        this.resetSessionState();
        // Belt-and-suspenders: skip done if we know an error happened this
        // session, OR if the current mood is already error.
        if (this.hasError || this.state.mood === "error") {
          console.log(
            "[state-deriver] session.idle after error — skipping done",
          );
          this.hasError = false;
          break;
        }
        this.handleEvent({ type: "SessionCompleted" });
        break;
      }
    }
  }

  getCurrentMood(): PetMood {
    return this.state.mood;
  }

  dispose(): void {
    this.resetSessionState();
    this.hasError = false;
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private resetSessionState(): void {
    this.activeStreamParts.clear();
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

  /**
   * Schedule a timer to fire when the current temporary state expires.
   * If no temporary state is active, clear any pending expiry timer.
   */
  private manageExpiryTimer(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }

    if (this.state.temporary && this.state.expiresAt) {
      const delay = Math.max(0, this.state.expiresAt - Date.now());
      this.expiryTimer = setTimeout(() => {
        this.expiryTimer = null;
        // Force expiry check by calling reducer with IdleTimeout.
        // The reducer's expiry check at the top will revert the temporary
        // state before IdleTimeout's own logic runs.
        this.handleEvent({ type: "IdleTimeout" });
      }, delay);
    }
  }
}
