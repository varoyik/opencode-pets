# ipc-server

## Purpose

Unix domain socket IPC server in the overlay main process. Receives JSON-formatted messages from the plugin, validates them against Zod schemas, and forwards commands to the renderer via Electron IPC.

## Requirements

### Requirement: Unix socket server starts on overlay launch

The overlay main process SHALL create a Unix domain socket server on startup that listens for JSON-formatted IPC messages from the plugin.

#### Scenario: Socket server starts and listens

- **WHEN** the overlay application starts and the BrowserWindow is ready
- **THEN** a Unix domain socket server is created at `/tmp/opencode-pets-{uid}/opencode-pets.sock` and accepts incoming connections

#### Scenario: Socket server stops on app quit

- **WHEN** the Electron app quits (all windows closed)
- **THEN** the socket server stops listening, closes all active connections, and the socket file is removed from the filesystem

### Requirement: Socket permissions and security

The socket server SHALL use `0o600` permissions (owner read/write only) and SHALL remove any stale socket file from a previous crashed instance before binding.

#### Scenario: Socket file has owner-only permissions

- **WHEN** the socket file is created
- **THEN** it has file permissions `0600`, preventing access by other users on the system

#### Scenario: Stale socket is cleaned up

- **WHEN** a socket file from a previous crashed instance exists at the socket path
- **THEN** the server removes the stale file before creating a new socket

### Requirement: JSON message protocol

The socket server SHALL accept newline-delimited JSON messages. Each message SHALL be parsed and validated against Zod schemas defined in `packages/core/src/ipc.ts`. Invalid messages SHALL be dropped with a console warning. The supported inbound message types are: `set_mood`, `show_bubble`, `toggle_visibility`, `set_config`, `set_pets`, and `switch_pet`. The supported outbound message types are: `switch_pet`, `quit_pet`, and `hidden`.

#### Scenario: Valid message is parsed and forwarded

- **WHEN** the server receives `{"type":"set_mood","payload":{"mood":"working"}}\n`
- **THEN** the message is parsed, validated, and forwarded to the renderer via Electron IPC

#### Scenario: Invalid message is dropped

- **WHEN** the server receives `{"type":"set_mood","payload":{"mood":"unknown"}}\n` (invalid mood value)
- **THEN** a warning is logged to the console and the message is not forwarded to the renderer

#### Scenario: Malformed JSON is dropped

- **WHEN** the server receives non-JSON data (e.g., `not json\n`)
- **THEN** a warning is logged to the console and the message is dropped without crashing the server

#### Scenario: Valid set_config message is parsed and forwarded

- **WHEN** the server receives `{"type":"set_config","payload":{"defaultPet":"gutsy","idleTimeoutMs":15000,"bubbleDurationMs":3000}}\n`
- **THEN** the message is parsed, validated, and forwarded to the renderer via Electron IPC

#### Scenario: Valid set_pets message is parsed and forwarded

- **WHEN** the server receives `{"type":"set_pets","payload":{"pets":[{"id":"gutsy","displayName":"Gutsy","spritesheetPath":"/path/to/gutsy.webp"}]}}\n`
- **THEN** the message is parsed, validated, and forwarded to the renderer via Electron IPC

#### Scenario: Valid switch_pet message is parsed and forwarded

- **WHEN** the server receives `{"type":"switch_pet","payload":{"petId":"gutsy","spritesheetPath":"/path/to/gutsy.webp"}}\n`
- **THEN** the message is parsed, validated, and forwarded to the renderer via Electron IPC

#### Scenario: Invalid switch_pet message is dropped

- **WHEN** the server receives `{"type":"switch_pet","payload":{"petId":"unknown"}}` (missing spritesheetPath)
- **THEN** a warning is logged and the message is not forwarded

### Requirement: set_mood message forwards to renderer

When the socket server receives a valid `set_mood` message, it SHALL forward the mood value to the renderer process via `BrowserWindow.webContents.send("mood-changed", mood)`.

#### Scenario: Mood is forwarded to renderer

- **WHEN** the server receives `{"type":"set_mood","payload":{"mood":"working"}}`
- **THEN** the renderer receives a `mood-changed` IPC event with the value `"working"`

### Requirement: show_bubble message forwards to renderer

When the socket server receives a valid `show_bubble` message, it SHALL forward the text and optional duration to the renderer via `BrowserWindow.webContents.send("show-bubble", text, duration)`.

#### Scenario: Bubble text is forwarded to renderer

- **WHEN** the server receives `{"type":"show_bubble","payload":{"text":"Running: bash","duration":3000}}`
- **THEN** the renderer receives a `show-bubble` IPC event with text `"Running: bash"` and duration `3000`

#### Scenario: Bubble with default duration

- **WHEN** the server receives `{"type":"show_bubble","payload":{"text":"Hello"}}` (no duration)
- **THEN** the renderer receives a `show-bubble` IPC event with text `"Hello"` and a default duration of `5000`

### Requirement: toggle_visibility controls window visibility

When the socket server receives a `toggle_visibility` message, the main process SHALL toggle the BrowserWindow between shown and hidden states.

#### Scenario: Window hidden on toggle when visible

- **WHEN** the BrowserWindow is visible and the server receives `{"type":"toggle_visibility","payload":{}}`
- **THEN** the BrowserWindow becomes hidden (`win.hide()`)

#### Scenario: Window shown on toggle when hidden

- **WHEN** the BrowserWindow is hidden and the server receives `{"type":"toggle_visibility","payload":{}}`
- **THEN** the BrowserWindow becomes visible (`win.show()`)

### Requirement: set_config message forwards to renderer

When the socket server receives a valid `set_config` message, it SHALL forward the config values to the renderer process via `BrowserWindow.webContents.send("config-changed", config)`.

#### Scenario: Config is forwarded to renderer

- **WHEN** the server receives `{"type":"set_config","payload":{"defaultPet":"gutsy","idleTimeoutMs":15000,"bubbleDurationMs":3000}}`
- **THEN** the renderer receives a `config-changed` IPC event with the config object

### Requirement: set_pets message forwards to renderer

When the socket server receives a valid `set_pets` message, it SHALL forward the pet list to the renderer via `BrowserWindow.webContents.send("pets-changed", pets)`.

#### Scenario: Pet list is forwarded to renderer

- **WHEN** the server receives `{"type":"set_pets","payload":{"pets":[{"id":"gutsy","displayName":"Gutsy","spritesheetPath":"/path/to/gutsy.webp"}]}}`
- **THEN** the renderer receives a `pets-changed` IPC event with the pet array

### Requirement: switch_pet message forwards to renderer

When the socket server receives a valid `switch_pet` message, it SHALL forward the resolved spritesheet path to the renderer via `BrowserWindow.webContents.send("switch-pet", resolvedPath)`.

#### Scenario: Pet switch is forwarded to renderer

- **WHEN** the server receives `{"type":"switch_pet","payload":{"petId":"gutsy","spritesheetPath":"/path/to/gutsy.webp"}}`
- **THEN** the renderer receives a `switch-pet` IPC event with the spritesheet path

### Requirement: Overlay-to-plugin messages are forwarded via socket

When the renderer sends a request via `ipcRenderer`, the main process SHALL forward it to the plugin via the Unix socket connection. The supported overlay-to-plugin messages are: `switch_pet`, `quit_pet`, and `hidden`.

#### Scenario: Renderer pet switch request reaches plugin

- **WHEN** the renderer sends `request-switch-pet` with `"gutsy"`
- **THEN** the plugin receives `{"type":"switch_pet","payload":{"petId":"gutsy"}}` over the Unix socket

### Requirement: quit_pet message sent on intentional quit

When the overlay is quitting intentionally (e.g., via the "Quit Pet" context menu action), it SHALL send a `quit_pet` message with an empty payload to the plugin before calling `app.quit()`. This allows the plugin to distinguish intentional quits from crashes.

#### Scenario: quit_pet sent before app exit

- **WHEN** the user clicks "Quit Pet" in the context menu
- **THEN** the overlay sends `{"type":"quit_pet","payload":{}}` to the plugin via socket
- **AND** then calls `app.quit()` to exit the Electron process

#### Scenario: quit_pet is valid IPC message

- **WHEN** the overlay sends `{"type":"quit_pet","payload":{}}\n` to the plugin
- **THEN** the message parses and validates successfully against the `IpcMessageSchema`

### Requirement: hidden message sent on window hide

When the overlay window is hidden intentionally (e.g., via the "Hide Pet" context menu action), it SHALL send a `hidden` message with an empty payload to the plugin. This allows the plugin to distinguish a hidden overlay from a quit overlay.

#### Scenario: hidden sent on Hide Pet

- **WHEN** the user clicks "Hide Pet" in the context menu
- **THEN** the overlay sends `{"type":"hidden","payload":{}}` to the plugin via socket
- **AND** then calls `win.hide()` to hide the BrowserWindow

#### Scenario: hidden is valid IPC message

- **WHEN** the overlay sends `{"type":"hidden","payload":{}}\n` to the plugin
- **THEN** the message parses and validates successfully against the `IpcMessageSchema`

### Requirement: Socket server is created via module function

The socket server SHALL be created via a module-level factory function `createSocketServer(socketPath: string, browserWindow: BrowserWindow)` that returns `{ start(): Promise<void>, stop(): Promise<void> }`.

#### Scenario: Server lifecycle via start/stop

- **WHEN** `createSocketServer(path, win)` is called and `start()` is invoked
- **THEN** the server begins listening on the socket path
- **WHEN** `stop()` is subsequently invoked
- **THEN** the server stops listening and cleans up the socket file
