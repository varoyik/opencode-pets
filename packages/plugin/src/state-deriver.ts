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
  part?: { id: string; type: string };
  delta?: string;
}

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
  private activeStreamParts = new Set<string>();

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

  handleSseEvent(event: SdkEvent): void {
    switch (event.type) {
      case "message.part.updated": {
        const { part, delta } = event.properties as PartUpdatedProps;

        if (
          part === undefined ||
          (part.type !== "text" && part.type !== "reasoning")
        ) {
          return;
        }

        if (delta !== undefined) {
          this.activeStreamParts.add(part.id);
          this.handleEvent({ type: "StreamStarted" });
        } else {
          this.activeStreamParts.delete(part.id);
          if (this.activeStreamParts.size === 0) {
            this.handleEvent({ type: "StreamEnded" });
          }
        }
        break;
      }
      case "permission.updated":
        this.handleEvent({ type: "PermissionPrompted" });
        break;
      case "permission.replied":
        this.handleEvent({ type: "PermissionResolved" });
        break;
      case "session.error":
        this.handleEvent({ type: "TaskErrored" });
        break;
      case "session.idle":
        this.handleEvent({ type: "IdleTimeout" });
        break;
    }
  }

  dispose(): void {
    this.activeStreamParts.clear();
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
