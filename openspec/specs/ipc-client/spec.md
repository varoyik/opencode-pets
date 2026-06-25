# ipc-client

## Purpose

Bun-based Unix socket client that connects to the overlay's IPC server and sends validated `IpcMessage` payloads. The client SHALL handle connection lifecycle, message queuing during reconnection, and graceful shutdown.

## Requirements

### Requirement: Unix socket connection

The IPC client SHALL connect to the overlay's Unix domain socket at `/tmp/opencode-pets-{uid}/opencode-pets.sock` using `Bun.connect()`. The socket path SHALL be configurable via constructor parameter, defaulting to the UID-based path.

#### Scenario: Successful connection

- **WHEN** the overlay's IPC server is running and listening on the socket
- **THEN** `Bun.connect()` establishes a connection and the client transitions to `connected` state

#### Scenario: Connection refused (overlay not ready)

- **WHEN** the overlay has not yet created the socket
- **THEN** the client enters retry mode with exponential backoff (100ms → 200ms → 400ms → cap 2s)

### Requirement: Lazy connection

The IPC client SHALL NOT connect immediately on construction. Instead, it SHALL defer connection until the first message is sent. This handles the race condition where the plugin initializes before the overlay socket is ready.

#### Scenario: First message triggers connection

- **WHEN** the first `send()` call is made and the client is not connected
- **THEN** the client initiates connection and queues the message for delivery after connection

### Requirement: Message queuing during connection

While the client is connecting or reconnecting, outgoing messages SHALL be queued in-memory. The queue SHALL have a maximum capacity of 10 messages. When the queue is full, the oldest message SHALL be dropped.

#### Scenario: Messages queued during connection

- **WHEN** 3 messages are sent while the client is in `connecting` state
- **THEN** all 3 messages are queued and delivered in order once the connection is established

#### Scenario: Queue overflow

- **WHEN** the message queue reaches 10 messages and an 11th is sent
- **THEN** the oldest message is dropped and the new message is appended

### Requirement: Stale queue prevention

When the overlay process spawns (first `/pet` command or reconnect after crash), the IPC client SHALL clear any queued mood messages that were accumulated before the overlay was visible. Only the current mood SHALL be sent after connection.

#### Scenario: Queue cleared on overlay spawn

- **WHEN** the overlay spawns and the IPC client connects
- **THEN** the message queue is cleared and only the latest `set_mood` message is sent

#### Scenario: No stale mood replay

- **WHEN** the plugin has queued moods `working → thinking → done → idle` before the overlay spawns
- **THEN** after the overlay spawns, only the current mood (e.g., `idle`) is sent, not the historical sequence

### Requirement: Message serialization

The client SHALL serialize outgoing messages as NDJSON (newline-delimited JSON) matching the overlay IPC server's expected format. Each message SHALL be a single line of JSON terminated by `\n`.

#### Scenario: set_mood message serialized

- **WHEN** `sendMood("working")` is called
- **THEN** the client writes `{"type":"set_mood","payload":{"mood":"working"}}\n` to the socket

#### Scenario: show_bubble message serialized

- **WHEN** `sendBubble("Running tests...", 3000)` is called
- **THEN** the client writes `{"type":"show_bubble","payload":{"text":"Running tests...","duration":3000}}\n` to the socket

#### Scenario: toggle_visibility message serialized

- **WHEN** `toggleVisibility()` is called
- **THEN** the client writes `{"type":"toggle_visibility","payload":{}}\n` to the socket

### Requirement: Reconnection with backoff

When the connection is lost (socket close, error), the client SHALL attempt reconnection with exponential backoff. The backoff sequence SHALL be: 100ms, 200ms, 400ms, 800ms, 1600ms, capped at 2000ms thereafter.

#### Scenario: Connection lost during operation

- **WHEN** the socket connection is severed unexpectedly
- **THEN** the client begins reconnection attempts with 100ms initial delay, doubling each attempt up to 2s

#### Scenario: Maximum retry attempts exhausted

- **WHEN** reconnection fails 10 consecutive times
- **THEN** the client logs an error and stops attempting; new `send()` calls restart the retry cycle

### Requirement: Graceful shutdown

The client SHALL expose a `close()` method that closes the socket connection and clears the message queue. After `close()` is called, all subsequent `send()` calls SHALL be no-ops.

#### Scenario: Client closed cleanly

- **WHEN** `close()` is called on a connected client
- **THEN** the socket is closed, the message queue is cleared, and further `send()` calls are ignored

#### Scenario: Close on already-closed client

- **WHEN** `close()` is called on an already-closed client
- **THEN** no error is thrown (idempotent close)

### Requirement: Current mood synchronization

The IPC client SHALL expose a method to send the current mood without queuing, for use when the overlay first connects or when the queue is cleared.

#### Scenario: Send current mood on demand

- **WHEN** `sendCurrentMood("working")` is called
- **THEN** the client sends `{"type":"set_mood","payload":{"mood":"working"}}\n` immediately if connected, or queues it if not
