import { reducer, INITIAL_STATE } from "@opencode-pets/core";
import type { PetMood, PetState, PetEvent } from "@opencode-pets/core";

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
  part: { id: string; type: string; text?: string };
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
  sendBubble(text: string, duration?: number): void;
}

/** Part types that indicate the agent is actively generating a response. */
const STREAM_PART_TYPES = new Set(["text", "reasoning", "step-start"]);

const IDLE_PHRASES = [
  "Just chilling...",
  "Watching you code...",
  "Zzz...",
  "Waiting for instructions...",
  "*stretch*",
];

const DONE_PHRASES = ["Done!", "Task complete!", "All done!"];
const ERROR_PHRASES = ["Oops!", "Something went wrong", "Error!"];

/**
 * Maps OpenCode tool names → friendly bubble text for the "working" state.
 * Covers all built-in tools plus permission-only values that may appear
 * in permission prompts (task, external_directory, doom_loop).
 */
const TOOL_BUBBLE_MAP: Record<string, string> = {
  bash: "Running command...",
  read: "Reading files...",
  write: "Writing files...",
  grep: "Searching code...",
  glob: "Searching files...",
  edit: "Editing files...",
  apply_patch: "Applying changes...",
  webfetch: "Fetching web content...",
  websearch: "Searching the web...",
  question: "Asking a question...",
  skill: "Loading skill...",
  todowrite: "Managing tasks...",
  lsp: "Getting code intelligence...",
  task: "Running subagent...",
  external_directory: "Accessing external files...",
  doom_loop: "Detecting repeated action...",
};

export class StateDeriver {
  private state: PetState;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ipcClient: IpcClientLike;
  private readonly idleTimeoutMs: number;
  private activeStreamParts = new Set<string>();
  private hasError = false;
  private currentBubbleText: string | null = null;
  private currentToolName: string | null = null;
  private currentReasoningText: string | null = null;
  private currentPermissionTitle: string | null = null;
  private idlePhraseIndex = 0;

  constructor(ipcClient: IpcClientLike, idleTimeoutMs = 30_000) {
    this.ipcClient = ipcClient;
    this.idleTimeoutMs = idleTimeoutMs;
    this.state = { ...INITIAL_STATE };
    this.resetIdleTimer();
  }

  handleEvent(event: PetEvent): void {
    // Extract context from event before calling the pure reducer
    if (event.type === "ToolRunning" && event.toolName) {
      this.currentToolName = event.toolName;
    }

    const newState = reducer(this.state, event);

    if (newState.mood !== this.state.mood) {
      this.ipcClient.sendMood(newState.mood);
      const bubbleText = this.resolveBubbleText(newState);
      this.currentBubbleText = bubbleText;
      this.ipcClient.sendBubble(bubbleText, this.getBubbleDuration(newState));
    } else if (this.shouldUpdateBubbleInSameMood(event, newState)) {
      const bubbleText = this.resolveBubbleText(newState);
      if (bubbleText !== this.currentBubbleText) {
        this.currentBubbleText = bubbleText;
        this.ipcClient.sendBubble(bubbleText, this.getBubbleDuration(newState));
      }
    }

    // When the temporary error state expires, clear the error flag so it
    // doesn't leak into the next session and silently skip its done celebration.
    if (this.hasError && newState.mood !== "error" && !newState.temporary) {
      this.hasError = false;
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

        // Compile-time cast provides no runtime guarantee — guard against
        // malformed events where `part` is missing.
        if (!part) return;

        // Track reasoning text for thinking bubbles
        if (part.type === "reasoning" && typeof part.text === "string") {
          this.currentReasoningText = part.text;
        }

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

      case "permission.asked": {
        const props = event.properties as { permission?: string };
        if (props.permission) {
          this.currentPermissionTitle = props.permission;
        }
        this.handleEvent({ type: "PermissionPrompted" });
        break;
      }

      case "permission.replied":
        this.handleEvent({ type: "PermissionResolved" });
        break;

      case "session.error":
        this.hasError = true;
        this.resetSessionState();
        this.handleEvent({ type: "TaskErrored" });
        break;

      case "session.idle": {
        this.resetSessionState();
        // Belt-and-suspenders: skip done if we know an error happened this
        // session, OR if the current mood is already error.
        if (this.hasError || this.state.mood === "error") {
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

  /**
   * Reset all state to initial — called when the overlay is spawned
   * so stale counters from pre-spawn SSE events don't leak into the
   * fresh pet session.
   */
  reset(): void {
    this.dispose();
    this.state = { ...INITIAL_STATE };
    this.currentBubbleText = null;
    this.idlePhraseIndex = 0;
    this.resetIdleTimer();
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

  private resolveBubbleText(state: PetState): string {
    switch (state.mood) {
      case "idle": {
        const phrase = IDLE_PHRASES[this.idlePhraseIndex];
        this.idlePhraseIndex = (this.idlePhraseIndex + 1) % IDLE_PHRASES.length;
        return phrase!;
      }
      case "thinking": {
        if (this.currentReasoningText) {
          return this.truncateText(this.currentReasoningText, 80);
        }
        return "Thinking...";
      }
      case "working": {
        if (this.currentToolName) {
          return TOOL_BUBBLE_MAP[this.currentToolName] ?? "Working...";
        }
        return "Working...";
      }
      case "waiting": {
        if (this.currentPermissionTitle) {
          const friendly =
            TOOL_BUBBLE_MAP[this.currentPermissionTitle] ??
            this.currentPermissionTitle;
          return `Asking: ${friendly}`;
        }
        return "Waiting for approval...";
      }
      case "done": {
        return DONE_PHRASES[Math.floor(Math.random() * DONE_PHRASES.length)]!;
      }
      case "error": {
        return ERROR_PHRASES[Math.floor(Math.random() * ERROR_PHRASES.length)]!;
      }
    }
  }

  private truncateText(text: string, maxLength: number): string {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength - 3).trim() + "...";
  }

  private getBubbleDuration(state: PetState): number | undefined {
    if (state.temporary && state.expiresAt) {
      return Math.max(0, state.expiresAt - Date.now());
    }
    return undefined;
  }

  private shouldUpdateBubbleInSameMood(
    event: PetEvent,
    state: PetState,
  ): boolean {
    switch (event.type) {
      case "ToolRunning":
        return state.mood === "working";
      case "StreamStarted":
        return state.mood === "thinking";
      case "PermissionPrompted":
        return state.mood === "waiting";
      default:
        return false;
    }
  }

  private resetSessionState(): void {
    this.activeStreamParts.clear();
    this.currentReasoningText = null;
    this.currentToolName = null;
    this.currentPermissionTitle = null;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.handleEvent({ type: "IdleTimeout" });
    }, this.idleTimeoutMs);
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
