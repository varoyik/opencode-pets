import { reducer, INITIAL_STATE } from "@opencode-pets/core";
import type { PetMood, PetState, PetEvent } from "@opencode-pets/core";

/**
 * Structural subset of an OpenCode SSE event across generations:
 * - V1 (<= 1.18): `{ id, type, properties }`
 * - V2 (2.x): `{ id, type, data }`
 * Properties presented by each generation hold the same payload under a
 * different key, so both are accepted here.
 */
export interface SseEventLike {
  readonly type: string;
  readonly properties?: unknown;
  readonly data?: unknown;
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

/**
 * Event types routed through the V2 handler. Covers OpenCode 2.x events and
 * the `session.next.*` / `permission.v2.*` events introduced in 1.18 (their
 * names are normalized to the 2.x form before this set is consulted).
 */
const V2_EVENT_TYPES = new Set([
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.text.started",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.delta",
  "session.reasoning.ended",
  "session.execution.failed",
  "session.status",
  "session.idle",
  "permission.asked",
  "permission.replied",
]);

/**
 * Raw event types that only exist on V2-generation streams. OpenCode 1.18
 * emits classic and V2 events for the same activity; the first V2 event
 * latches the generation so classic part events can be ignored.
 */
function isV2GenerationType(type: string): boolean {
  return (
    type.startsWith("session.next.") ||
    type.startsWith("session.step.") ||
    type.startsWith("session.text.") ||
    type.startsWith("session.reasoning.") ||
    type.startsWith("session.execution.") ||
    type.startsWith("session.tool.")
  );
}

/** Maps 1.18 event names onto their OpenCode 2.x equivalents. */
function normalizeEventType(type: string): string {
  if (type.startsWith("session.next.")) {
    return `session.${type.slice("session.next.".length)}`;
  }
  if (type.startsWith("permission.v2.")) {
    return `permission.${type.slice("permission.v2.".length)}`;
  }
  return type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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
  private v2Generation = false;

  constructor(ipcClient: IpcClientLike, idleTimeoutMs = 30_000) {
    this.ipcClient = ipcClient;
    this.idleTimeoutMs = idleTimeoutMs;
    this.state = { ...INITIAL_STATE };
    this.resetIdleTimer();
  }

  handleEvent(event: PetEvent): void {
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

    // Clear error flag after temp state expires — prevents session leak.
    if (this.hasError && newState.mood !== "error" && !newState.temporary) {
      this.hasError = false;
    }

    this.state = newState;

    // Only activity events reset the timer — not the timeout firing.
    if (event.type !== "IdleTimeout") {
      this.resetIdleTimer();
    }

    this.manageExpiryTimer();
  }

  handleSseEvent(event: SseEventLike): void {
    const payload = event.properties ?? event.data;

    if (isV2GenerationType(event.type)) {
      this.markV2Generation();
    }

    const type = normalizeEventType(event.type);
    if (V2_EVENT_TYPES.has(type)) {
      this.handleV2Event(type, payload);
      return;
    }

    this.handleClassicEvent(type, payload);
  }

  getCurrentMood(): PetMood {
    return this.state.mood;
  }

  /** Reset state for fresh spawn — clears stale pre-spawn counters. */
  reset(): void {
    this.dispose();
    this.state = { ...INITIAL_STATE };
    this.currentBubbleText = null;
    this.idlePhraseIndex = 0;
    this.v2Generation = false;
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

  /**
   * OpenCode 1.18 emits classic and V2 events for the same activity. Once V2
   * events appear, classic part events are ignored to avoid double counting.
   * Part states tracked before the switch are released so the stream counter
   * does not stay latched on stale classic parts.
   */
  private markV2Generation(): void {
    if (this.v2Generation) return;
    this.v2Generation = true;
    if (this.activeStreamParts.size === 0) return;
    this.activeStreamParts.clear();
    this.handleEvent({ type: "StreamEnded" });
  }

  private handleV2Event(type: string, payload: unknown): void {
    const data = isRecord(payload) ? payload : {};

    switch (type) {
      case "session.step.started": {
        this.trackStreamPart(this.v2StreamKey(data, "step"));
        break;
      }

      case "session.step.ended": {
        this.releaseStreamPart(this.v2StreamKey(data, "step"));
        break;
      }

      case "session.step.failed":
      case "session.execution.failed": {
        this.hasError = true;
        this.resetSessionState();
        this.handleEvent({ type: "TaskErrored" });
        break;
      }

      case "session.text.started": {
        this.trackStreamPart(this.v2StreamKey(data, "text"));
        break;
      }

      case "session.text.ended": {
        this.releaseStreamPart(this.v2StreamKey(data, "text"));
        break;
      }

      case "session.reasoning.started": {
        this.currentReasoningText = null;
        this.trackStreamPart(this.v2StreamKey(data, "reasoning"));
        break;
      }

      case "session.reasoning.delta": {
        const delta = data["delta"];
        if (typeof delta === "string") {
          this.currentReasoningText =
            (this.currentReasoningText ?? "") + delta;
          this.refreshThinkingBubble();
        }
        break;
      }

      case "session.reasoning.ended": {
        const text = data["text"];
        if (typeof text === "string") {
          this.currentReasoningText = text;
        }
        this.releaseStreamPart(this.v2StreamKey(data, "reasoning"));
        this.refreshThinkingBubble();
        break;
      }

      case "session.idle": {
        this.applyIdleSignal();
        break;
      }

      case "session.status": {
        const status = data["status"];
        if (
          isRecord(status) &&
          status["type"] === "idle" &&
          this.state.mood !== "idle" &&
          this.state.mood !== "done"
        ) {
          this.applyIdleSignal();
        }
        break;
      }

      case "permission.asked": {
        const title = data["action"] ?? data["permission"];
        if (typeof title === "string" && title !== "") {
          this.currentPermissionTitle = title;
        }
        this.handleEvent({ type: "PermissionPrompted" });
        break;
      }

      case "permission.replied": {
        this.handleEvent({ type: "PermissionResolved" });
        break;
      }
    }
  }

  private handleClassicEvent(type: string, payload: unknown): void {
    switch (type) {
      case "message.part.updated": {
        if (this.v2Generation) return;

        const props = payload as PartUpdatedProps | undefined;
        const part = props?.part;

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

        // Don't track by delta — always undefined in some SDK setups, causing rapid fire/cancel.
        if (!this.activeStreamParts.has(part.id)) {
          this.activeStreamParts.add(part.id);
          this.handleEvent({ type: "StreamStarted" });
        }
        break;
      }

      case "message.part.removed": {
        if (this.v2Generation) return;

        const partID = (payload as PartRemovedProps | undefined)?.partID;
        if (partID !== undefined && this.activeStreamParts.has(partID)) {
          this.activeStreamParts.delete(partID);
          if (this.activeStreamParts.size === 0) {
            this.handleEvent({ type: "StreamEnded" });
          }
        }
        break;
      }

      case "session.error":
        this.hasError = true;
        this.resetSessionState();
        this.handleEvent({ type: "TaskErrored" });
        break;
    }
  }

  /** Shared idle handling for `session.idle` and idle `session.status`. */
  private applyIdleSignal(): void {
    this.resetSessionState();
    // Belt-and-suspenders: skip done if we know an error happened this
    // session, OR if the current mood is already error.
    if (this.hasError || this.state.mood === "error") {
      this.hasError = false;
      return;
    }
    this.handleEvent({ type: "SessionCompleted" });
  }

  /**
   * Stream key for V2 events. 1.18 identifies streams with textID /
   * reasoningID, 2.x with ordinals; step events carry neither.
   */
  private v2StreamKey(data: Record<string, unknown>, kind: string): string {
    const id =
      data["ordinal"] ??
      data["textID"] ??
      data["reasoningID"] ??
      data["callID"] ??
      data["id"];
    return `${String(data["assistantMessageID"] ?? "")}:${kind}:${String(id ?? "")}`;
  }

  private trackStreamPart(key: string): void {
    if (this.activeStreamParts.has(key)) return;
    this.activeStreamParts.add(key);
    this.handleEvent({ type: "StreamStarted" });
  }

  private releaseStreamPart(key: string): void {
    if (!this.activeStreamParts.delete(key)) return;
    if (this.activeStreamParts.size === 0) {
      this.handleEvent({ type: "StreamEnded" });
    }
  }

  /** Refresh the thinking bubble while reasoning deltas accumulate. */
  private refreshThinkingBubble(): void {
    if (this.state.mood !== "thinking") return;
    const bubbleText = this.resolveBubbleText(this.state);
    if (bubbleText === this.currentBubbleText) return;
    this.currentBubbleText = bubbleText;
    this.ipcClient.sendBubble(bubbleText, this.getBubbleDuration(this.state));
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

  /** Fire expiry timer when temporary state expires. */
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
