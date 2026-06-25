import type { LogFn, PetMood, Config, PetManifest } from "@opencode-pets/core";
import { parseIpcMessage, getSocketPath } from "@opencode-pets/core";
import { createConnection } from "node:net";
import type { Socket as NetSocket } from "node:net";

const MAX_QUEUE_SIZE = 10;
const MAX_RETRIES = 10;
const INITIAL_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 2000;

const SET_MOOD_PREFIX = '{"type":"set_mood"';
const SHOW_BUBBLE_PREFIX = '{"type":"show_bubble"';

type ClientState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export class IpcClient {
  private socket: Bun.Socket | NetSocket | null = null;
  private socketKind: "bun" | "net" | null = null;
  private netDrainPending = false;
  private state: ClientState = "idle";
  private queue: string[] = [];
  private retryCount = 0;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnected = false;
  private readonly socketPath: string;
  private currentConfig: Config | null = null;
  private currentPets: PetManifest[] | null = null;
  private currentMood: PetMood | null = null;
  private initialMood: PetMood | null = null;
  private onSwitchPetCallback: ((petId: string) => void) | null = null;
  private onQuitPetCallback: (() => void) | null = null;
  private onHiddenCallback: (() => void) | null = null;
  private incomingBuffer = "";
  private overlayQuitting = false;
  private overlayHidden = false;
  private readonly log: LogFn | undefined;
  private readonly onReconnectExhausted: (() => void) | undefined;

  constructor(
    socketPath?: string,
    log?: LogFn,
    onReconnectExhausted?: () => void,
  ) {
    this.log = log;
    this.onReconnectExhausted = onReconnectExhausted;
    this.socketPath = socketPath ?? getSocketPath();
  }

  private doLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    this.log?.(level, message, extra);
  }

  private buildMessage(type: string, payload: unknown): string {
    return JSON.stringify({ type, payload }) + "\n";
  }

  sendMood(mood: PetMood): void {
    this.currentMood = mood;
    this.send(this.buildMessage("set_mood", { mood }));
  }

  sendBubble(text: string, duration?: number): void {
    const payload: { text: string; duration?: number } = { text };
    if (duration !== undefined) {
      payload.duration = duration;
    }
    this.send(this.buildMessage("show_bubble", payload));
  }

  toggleVisibility(): void {
    this.send(this.buildMessage("toggle_visibility", {}));
  }

  sendConfig(config: Config): void {
    this.currentConfig = config;
    this.send(this.buildMessage("set_config", config));
  }

  sendPets(pets: PetManifest[]): void {
    this.currentPets = pets;
    this.send(this.buildMessage("set_pets", { pets }));
  }

  sendSwitchPet(petId: string, resolvedPath: string): void {
    this.send(
      this.buildMessage("switch_pet", { petId, spritesheetPath: resolvedPath }),
    );
  }

  onSwitchPet(callback: (petId: string) => void): void {
    this.onSwitchPetCallback = callback;
  }

  onQuitPet(callback: () => void): void {
    this.onQuitPetCallback = callback;
  }

  onHidden(callback: () => void): void {
    this.onHiddenCallback = callback;
  }

  isOverlayQuitting(): boolean {
    return this.overlayQuitting;
  }

  isOverlayHidden(): boolean {
    return this.overlayHidden;
  }

  resetQuittingState(): void {
    this.overlayQuitting = false;
  }

  setOverlayHidden(hidden: boolean): void {
    this.overlayHidden = hidden;
  }

  /** Queue current mood as initial for next handshake, dropping stale moods from queue. */
  sendCurrentMood(mood: PetMood): void {
    if (this.state === "closed") return;
    this.currentMood = mood;
    this.initialMood = mood;
    this.clearStaleMoodMessages();
    this.send(this.buildMessage("set_mood", { mood }));
  }

  private cleanupSocket(): void {
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        // Ignore cleanup errors
      }
      this.socket = null;
      this.socketKind = null;
      this.netDrainPending = false;
    }
  }

  close(): void {
    this.state = "closed";
    this.overlayHidden = false;
    this.resetState();
  }

  private resetState(): void {
    this.queue = [];
    this.incomingBuffer = "";
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    this.cleanupSocket();
  }

  private send(data: string): void {
    if (this.state === "closed") return;

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
    }
    this.queue.push(data);

    if (this.state === "idle") {
      this.retryCount = 0;
      this.connect();
    } else if (this.state === "connected" && this.socket) {
      this.flushQueue();
    }
  }

  private connect(): void {
    if (this.state === "closed" || this.overlayQuitting) return;
    this.state = "connecting";

    if (process.platform === "win32") {
      this.connectWindows();
    } else {
      this.connectUnix();
    }
  }

  private onConnected(
    socket: Bun.Socket | NetSocket,
    kind: "bun" | "net",
  ): void {
    this.socket = socket;
    this.socketKind = kind;
    this.state = "connected";
    this.retryCount = 0;
    this.hasConnected = true;
    this.clearStaleStateMessages();
    this.sendHandshake();
    this.flushQueue();
  }

  private connectWindows(): void {
    const socket = createConnection({ path: this.socketPath });
    socket.setEncoding("utf-8");
    this.socketKind = "net";

    socket.on("connect", () => {
      this.onConnected(socket, "net");
    });

    socket.on("data", (data: string) => {
      this.handleIncomingData(data);
    });

    socket.on("close", () => {
      this.socket = null;
      this.socketKind = null;
      this.handleDisconnect();
    });

    socket.on("error", (err: Error) => {
      if (this.hasConnected) {
        this.doLog("debug", "socket error", { error: err.message });
      }
    });

    socket.on("end", () => {
      this.socket = null;
      this.socketKind = null;
      this.handleDisconnect();
    });
  }

  private connectUnix(): void {
    Bun.connect({
      unix: this.socketPath,
      socket: {
        open: (socket) => {
          this.onConnected(socket, "bun");
        },
        data: (_socket, data: Buffer | string) => {
          this.handleIncomingData(data);
        },
        close: (_socket, error) => {
          this.socket = null;
          this.socketKind = null;
          if (error && !this.overlayQuitting) {
            this.doLog("debug", "socket closed with error", {
              error: error.message,
            });
          }
          this.handleDisconnect();
        },
        error: (_socket, error) => {
          this.doLog("debug", "socket error", { error: error.message });
        },
        connectError: (_socket, error) => {
          if (this.hasConnected) {
            this.doLog("debug", "connection failed", {
              error: error.message,
            });
          }
        },
        end: (_socket) => {
          this.socket = null;
          this.socketKind = null;
          this.handleDisconnect();
        },
      },
    }).catch(() => {
      if (this.overlayQuitting) {
        this.state = "idle";
      } else if (this.state === "connecting") {
        this.state = "reconnecting";
        this.scheduleReconnect();
      }
    });
  }

  private handleDisconnect(): void {
    if (this.state !== "closed" && !this.overlayQuitting) {
      this.state = "reconnecting";
      this.scheduleReconnect();
    } else if (this.overlayQuitting) {
      this.state = "idle";
    }
  }

  private sendHandshake(): void {
    const messages: string[] = [];
    if (this.currentConfig) {
      messages.push(this.buildMessage("set_config", this.currentConfig));
    }
    if (this.currentPets) {
      messages.push(this.buildMessage("set_pets", { pets: this.currentPets }));
    }
    const moodToSend = this.initialMood ?? this.currentMood;
    if (moodToSend) {
      messages.push(this.buildMessage("set_mood", { mood: moodToSend }));
    }
    this.initialMood = null;

    // Prepend handshake messages so they are sent before any queued messages.
    this.queue.unshift(...messages);
    this.flushQueue();
  }

  private handleIncomingData(data: Buffer | string): void {
    this.incomingBuffer +=
      typeof data === "string" ? data : data.toString("utf-8");
    const lines = this.incomingBuffer.split("\n");
    this.incomingBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;

      let raw: unknown;
      try {
        raw = JSON.parse(trimmed);
      } catch {
        this.doLog("warn", "Invalid IPC JSON received", { raw: trimmed });
        continue;
      }

      const msg = parseIpcMessage(raw);
      if (!msg) {
        this.doLog("warn", "Invalid IPC message received", { raw: trimmed });
        continue;
      }

      if (msg.type === "switch_pet" && this.onSwitchPetCallback) {
        this.onSwitchPetCallback(msg.payload.petId);
      } else if (msg.type === "quit_pet") {
        this.overlayQuitting = true;
        this.onQuitPetCallback?.();
        this.state = "idle";
        this.resetState();
      } else if (msg.type === "hidden") {
        this.overlayHidden = true;
        if (this.onHiddenCallback) {
          this.onHiddenCallback();
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.backoffTimer !== null) return;

    if (this.overlayQuitting) {
      this.state = "idle";
      this.doLog("debug", "overlay quit intentionally — not reconnecting");
      return;
    }

    if (this.retryCount >= MAX_RETRIES) {
      this.state = "idle";
      this.doLog("error", "reconnection exhausted", {
        retries: MAX_RETRIES,
      });
      this.onReconnectExhausted?.();
      return;
    }

    const delay = Math.min(
      INITIAL_BACKOFF_MS * 2 ** this.retryCount,
      MAX_BACKOFF_MS,
    );
    this.retryCount++;

    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      this.connect();
    }, delay);
  }

  private flushQueue(): void {
    if (!this.socket) return;

    while (this.queue.length > 0) {
      const data = this.queue[0]!;

      if (this.socketKind === "net") {
        const socket = this.socket as NetSocket;
        const flushed = socket.write(data);
        if (!flushed) {
          if (!this.netDrainPending) {
            this.netDrainPending = true;
            socket.once("drain", () => {
              this.netDrainPending = false;
              this.flushQueue();
            });
          }
          return;
        }
        this.queue.shift();
      } else {
        const socket = this.socket as Bun.Socket;
        const written = socket.write(data);
        if (written < 0) {
          break;
        }
        if (written < data.length) {
          this.queue[0] = data.slice(written);
          break;
        }
        this.queue.shift();
      }
    }
  }

  private clearMessagesByPrefix(...prefixes: string[]): void {
    this.queue = this.queue.filter(
      (msg) => !prefixes.some((p) => msg.startsWith(p)),
    );
  }

  /**
   * Remove all queued set_mood messages except the latest one.
   * Prevents stale mood replay when the overlay reconnects.
   */
  private clearStaleMoodMessages(): void {
    let lastMoodIndex = -1;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]!.startsWith(SET_MOOD_PREFIX)) {
        lastMoodIndex = i;
        break;
      }
    }

    if (lastMoodIndex === -1) {
      return;
    }

    this.queue = this.queue.filter(
      (msg, idx) => !msg.startsWith(SET_MOOD_PREFIX) || idx === lastMoodIndex,
    );
  }

  /** Clear queued mood+bubble before handshake — prevents stale SSE overrides. */
  private clearStaleStateMessages(): void {
    this.clearMessagesByPrefix(SET_MOOD_PREFIX, SHOW_BUBBLE_PREFIX);
  }
}
