import type { PetMood, Config, PetManifest } from "@opencode-pets/core";
import { parseIpcMessage } from "@opencode-pets/core";

const MAX_QUEUE_SIZE = 10;
const MAX_RETRIES = 10;
const INITIAL_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 2000;

const SET_MOOD_PREFIX = '{"type":"set_mood"';

type ClientState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

function getDefaultSocketPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  return `/tmp/opencode-pets-${uid}/opencode-pets.sock`;
}

export class IpcClient {
  private socket: Bun.Socket | null = null;
  private state: ClientState = "idle";
  private queue: string[] = [];
  private retryCount = 0;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnected = false;
  private readonly socketPath: string;
  private currentConfig: Config | null = null;
  private currentPets: PetManifest[] | null = null;
  private currentMood: PetMood | null = null;
  private onSwitchPetCallback: ((petId: string) => void) | null = null;
  private incomingBuffer = "";

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? getDefaultSocketPath();
  }

  private buildMoodMessage(mood: PetMood): string {
    return (
      JSON.stringify({
        type: "set_mood",
        payload: { mood },
      }) + "\n"
    );
  }

  sendMood(mood: PetMood): void {
    this.currentMood = mood;
    this.send(this.buildMoodMessage(mood));
  }

  sendBubble(text: string, duration?: number): void {
    const payload: { text: string; duration?: number } = { text };
    if (duration !== undefined) {
      payload.duration = duration;
    }
    const msg =
      JSON.stringify({
        type: "show_bubble",
        payload,
      }) + "\n";
    this.send(msg);
  }

  toggleVisibility(): void {
    const msg =
      JSON.stringify({
        type: "toggle_visibility",
        payload: {},
      }) + "\n";
    this.send(msg);
  }

  sendConfig(config: Config): void {
    this.currentConfig = config;
    const msg =
      JSON.stringify({
        type: "set_config",
        payload: config,
      }) + "\n";
    this.send(msg);
  }

  sendPets(pets: PetManifest[]): void {
    this.currentPets = pets;
    const msg =
      JSON.stringify({
        type: "set_pets",
        payload: { pets },
      }) + "\n";
    this.send(msg);
  }

  sendSwitchPet(petId: string, resolvedPath: string): void {
    const msg =
      JSON.stringify({
        type: "switch_pet",
        payload: { petId, spritesheetPath: resolvedPath },
      }) + "\n";
    this.send(msg);
  }

  onSwitchPet(callback: (petId: string) => void): void {
    this.onSwitchPetCallback = callback;
  }

  /**
   * Send the current mood immediately if connected, or queue it if not.
   * Unlike sendMood(), this does not append to the queue if already connected —
   * it writes directly to the socket. Used after overlay spawn to ensure
   * only the current mood is reflected, not stale history.
   */
  sendCurrentMood(mood: PetMood): void {
    if (this.state === "closed") return;

    this.currentMood = mood;
    const msg = this.buildMoodMessage(mood);

    if (this.state === "connected" && this.socket) {
      this.socket.write(msg);
    } else {
      // Not connected — queue it, but first clear any stale set_mood messages
      this.clearStaleMoodMessages();
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        this.queue.shift();
      }
      this.queue.push(msg);

      if (this.state === "idle") {
        this.retryCount = 0;
        this.connect();
      }
    }
  }

  close(): void {
    this.state = "closed";
    this.queue = [];
    this.incomingBuffer = "";

    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }

    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        // Ignore cleanup errors
      }
      this.socket = null;
    }
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
    if (this.state === "closed") return;
    this.state = "connecting";

    Bun.connect({
      unix: this.socketPath,
      socket: {
        open: (socket) => {
          this.socket = socket;
          this.state = "connected";
          this.retryCount = 0;
          this.hasConnected = true;
          // Send handshake: config → pets → mood
          this.sendHandshake();
          // Clear stale mood history before flushing
          this.clearStaleMoodMessages();
          this.flushQueue();
        },
        data: (_socket, data: Buffer | string) => {
          this.handleIncomingData(data);
        },
        close: (_socket, error) => {
          this.socket = null;
          if (error) {
            console.error(
              "[ipc-client] socket closed with error:",
              error.message,
            );
          }
          if (this.state !== "closed") {
            this.state = "reconnecting";
            this.scheduleReconnect();
          }
        },
        error: (_socket, error) => {
          console.error("[ipc-client] socket error:", error.message);
        },
        connectError: (_socket, error) => {
          if (this.hasConnected) {
            console.error("[ipc-client] connection failed:", error.message);
          }
        },
        end: (_socket) => {
          this.socket = null;
          if (this.state !== "closed") {
            this.state = "reconnecting";
            this.scheduleReconnect();
          }
        },
      },
    })
      .then(() => {
        if (this.state === "connecting") {
          this.state = "connected";
          this.retryCount = 0;
          this.clearStaleMoodMessages();
          this.flushQueue();
        }
      })
      .catch(() => {
        if (this.state === "connecting") {
          this.state = "reconnecting";
          this.scheduleReconnect();
        }
      });
  }

  private sendHandshake(): void {
    if (!this.socket) return;
    if (this.currentConfig) {
      this.socket.write(
        JSON.stringify({ type: "set_config", payload: this.currentConfig }) +
          "\n",
      );
    }
    if (this.currentPets) {
      this.socket.write(
        JSON.stringify({
          type: "set_pets",
          payload: { pets: this.currentPets },
        }) + "\n",
      );
    }
    if (this.currentMood) {
      this.socket.write(this.buildMoodMessage(this.currentMood));
    }
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
        console.warn("[ipc-client] Invalid JSON:", trimmed);
        continue;
      }

      const msg = parseIpcMessage(raw);
      if (!msg) {
        console.warn("[ipc-client] Invalid IPC message:", trimmed);
        continue;
      }

      if (msg.type === "switch_pet" && this.onSwitchPetCallback) {
        this.onSwitchPetCallback(msg.payload.petId);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.backoffTimer !== null) return;

    if (this.retryCount >= MAX_RETRIES) {
      this.state = "idle";
      console.error(
        "[ipc-client] reconnection exhausted after",
        MAX_RETRIES,
        "attempts",
      );
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
      const written = this.socket.write(data);
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

    // Keep only non-set_mood messages and the last set_mood message
    this.queue = this.queue.filter(
      (msg, idx) => !msg.startsWith(SET_MOOD_PREFIX) || idx === lastMoodIndex,
    );
  }
}
