# plugin-lifecycle

## Purpose

Plugin initialization, overlay process spawning via `Bun.spawn()`, health verification, and cleanup on OpenCode shutdown. The plugin SHALL manage the overlay as a child process throughout its lifecycle.

## Requirements

### Requirement: Plugin initializes on OpenCode start

The plugin SHALL be an async function exported as default from `packages/plugin/src/index.ts` conforming to the `Plugin` type from `@opencode-ai/plugin`. On initialization, it SHALL receive a `PluginInput` context containing `client`, `project`, `directory`, `worktree`, `serverUrl`, and `$` (Bun shell).

#### Scenario: Plugin function called by OpenCode

- **WHEN** OpenCode loads the plugin from its plugin array
- **THEN** the plugin async function is invoked with `PluginInput` and returns a `Hooks` object

### Requirement: Config and pet scanning on plugin init

The plugin SHALL initialize the config system and scan for available pets during initialization, before spawning the overlay. The config SHALL be read (or created with defaults), validated, and stored in memory. Pet scanning SHALL run asynchronously and SHALL complete before the first IPC connect handshake.

#### Scenario: Config initialized on startup

- **WHEN** the plugin initializes
- **THEN** it reads or creates `opencode-pets.json`, validates it, and stores the config object

#### Scenario: Pet scanning completes before overlay connect

- **WHEN** the plugin initializes and the overlay spawns
- **THEN** pet scanning has completed and the pet list is available for the IPC connect handshake

#### Scenario: Config hot-reload starts after init

- **WHEN** the plugin finishes initialization
- **THEN** it starts watching `opencode-pets.json` for changes via `fs.watch()`

### Requirement: IPC connect handshake includes config and pets

When the IPC client connects to the overlay, the plugin SHALL send `set_config` followed by `set_pets` followed by `set_mood` (existing behavior) in that order.

#### Scenario: Full state sync on connect

- **WHEN** the IPC client successfully connects to the overlay socket
- **THEN** the plugin sends `set_config`, then `set_pets`, then `set_mood` to the overlay

#### Scenario: Config change triggers re-send

- **WHEN** `opencode-pets.json` is modified and passes validation
- **THEN** the plugin sends `set_config` to the overlay with the new values

### Requirement: Overlay process spawned on plugin init

The plugin SHALL spawn the overlay Electron process during initialization via `Bun.spawn()`. The overlay binary SHALL be resolved from the well-known path `~/.opencode-pets/overlay/`. Both the plugin and overlay independently compute the same socket path (`/tmp/opencode-pets-{uid}/opencode-pets.sock`) using the user's UID, so no CLI arguments are required.

#### Scenario: Overlay spawned successfully

- **WHEN** the plugin initializes and the overlay binary exists at `~/.opencode-pets/overlay/`
- **THEN** `Bun.spawn()` launches the overlay process and the process PID is tracked for cleanup

#### Scenario: Overlay binary not found

- **WHEN** the overlay binary does not exist at the well-known path
- **THEN** the plugin logs an error via `client.app.log()` and continues without a pet (graceful degradation, no crash)

### Requirement: Health verification after spawn

The plugin SHALL verify the overlay is ready by confirming the Unix socket file exists at the expected path within a 15-second timeout after spawn. If the socket does not appear within the timeout, the plugin SHALL log a warning and continue — the IpcClient handles late socket binding via its exponential-backoff reconnection logic.

#### Scenario: Socket appears within timeout

- **WHEN** the overlay spawns and creates the socket within 15 seconds
- **THEN** the plugin returns the Subprocess reference and proceeds with IPC

#### Scenario: Socket timeout

- **WHEN** the socket does not appear within 15 seconds
- **THEN** the plugin logs a warning and returns the process anyway; the IpcClient retries connecting with exponential backoff

### Requirement: Plugin handles quit_pet message

When the plugin receives a `quit_pet` message from the overlay, it SHALL set an internal flag indicating the overlay was intentionally quit. It SHALL stop attempting to reconnect to or respawn the overlay. The overlay process is expected to exit on its own after sending `quit_pet`.

#### Scenario: quit_pet stops reconnect

- **WHEN** the plugin receives `quit_pet` from the overlay
- **THEN** an `overlayQuitting` flag is set to `true`
- **AND** the plugin stops exponential-backoff reconnection attempts
- **AND** the plugin does not respawn the overlay on disconnect

#### Scenario: quit_pet does not trigger error logs

- **WHEN** the overlay disconnects after sending `quit_pet`
- **THEN** the plugin logs an informational message, not an error or warning
- **AND** no reconnection attempts are made

### Requirement: Plugin handles hidden message

When the plugin receives a `hidden` message from the overlay, it SHALL track that the overlay is hidden but still running. This distinguishes a hidden overlay from a quit overlay.

#### Scenario: hidden tracked separately

- **WHEN** the plugin receives `hidden` from the overlay
- **THEN** the plugin records that the overlay is hidden
- **AND** the plugin does not attempt to reconnect (socket is still open)

### Requirement: Cleanup on OpenCode shutdown via dispose hook

The plugin SHALL perform cleanup in the `dispose()` hook returned by the Plugin interface. This hook SHALL kill the overlay process, dispose the state deriver, close the IPC client, and stop the config watcher — irrespective of whether the overlay was hidden, quit, or running. Reconnection-exhausted state (idle with `overlayQuitting === false`) SHALL be treated the same as running for cleanup purposes.

#### Scenario: dispose kills overlay regardless of visibility

- **WHEN** OpenCode shuts down
- **THEN** the plugin's `dispose()` hook is called
- **AND** the state deriver is disposed
- **AND** the overlay process is killed (if alive)
- **AND** the IPC client is closed
- **AND** the config watcher is unregistered

#### Scenario: Shutdown with hidden overlay

- **WHEN** OpenCode shuts down and the overlay is hidden
- **THEN** `dispose()` still kills the overlay process
- **AND** the overlay does not need to send `quit_pet` (the plugin initiated shutdown)

#### Scenario: Shutdown with quit overlay

- **WHEN** OpenCode shuts down and the overlay was previously quit (overlay process already dead)
- **THEN** `dispose()` skips `killOverlay()` (process is null)
- **AND** still disposes state deriver, closes IPC client, and unregisters config watcher

### Requirement: Plugin calls ensureOverlayInstalled before spawning

The plugin SHALL call `ensureOverlayInstalled(ctx.client, log)` during initialization, before attempting to spawn the overlay process. If the function returns `false` (download failed), the plugin SHALL return hooks without overlay management — the `event` hook and other non-overlay hooks still function, but no overlay process is spawned and no IPC client is created.

#### Scenario: Overlay installed — proceed to spawn

- **WHEN** the plugin initializes
- **AND** `ensureOverlayInstalled()` returns `true`
- **THEN** the plugin proceeds to spawn the overlay via `Bun.spawn()`
- **AND** the IPC client is created and connects to the overlay socket

#### Scenario: Overlay download failed — graceful degradation

- **WHEN** the plugin initializes
- **AND** `ensureOverlayInstalled()` returns `false`
- **THEN** the plugin returns hooks without spawning the overlay
- **AND** no IPC client is created
- **AND** the `event` hook still functions (receives SSE events but does nothing with them)
- **AND** no error is thrown

### Requirement: Overlay manager spawns from production path

The `spawnOverlay()` function in `overlay-manager.ts` SHALL resolve the Electron binary from the electron-builder output structure when running in production mode (VERSION file exists). The binary path SHALL be platform-specific:

- **Linux**: `~/.opencode-pets/overlay/opencode-pets-overlay` (ELF binary from `linux-unpacked/`)
- **macOS**: `~/.opencode-pets/overlay/opencode-pets-overlay.app/Contents/MacOS/opencode-pets-overlay`
- **Windows**: `~/.opencode-pets/overlay/opencode-pets-overlay.exe`

#### Scenario: Production spawn on Linux

- **WHEN** `spawnOverlay()` is called and `~/.opencode-pets/overlay/VERSION` exists
- **THEN** the binary is resolved as `~/.opencode-pets/overlay/opencode-pets-overlay`
- **AND** `Bun.spawn()` launches it with `cwd` set to `~/.opencode-pets/overlay/`

#### Scenario: Production spawn on macOS

- **WHEN** `spawnOverlay()` is called and `~/.opencode-pets/overlay/VERSION` exists
- **THEN** the binary is resolved as `~/.opencode-pets/overlay/opencode-pets-overlay.app/Contents/MacOS/opencode-pets-overlay`

#### Scenario: Production spawn on Windows

- **WHEN** `spawnOverlay()` is called and `~/.opencode-pets/overlay/VERSION` exists
- **THEN** the binary is resolved as `~/.opencode-pets/overlay/opencode-pets-overlay.exe`

### Requirement: Dev mode fallback to symlinked Electron

When the VERSION file does NOT exist at `~/.opencode-pets/overlay/VERSION`, the overlay manager SHALL fall back to the dev mode path: resolving Electron from `~/.opencode-pets/overlay/node_modules/.bin/electron` (symlinked by `setup-dev.sh`). This preserves the existing development workflow.

#### Scenario: Dev mode spawn

- **WHEN** `spawnOverlay()` is called and `~/.opencode-pets/overlay/VERSION` does not exist
- **AND** `~/.opencode-pets/overlay/node_modules/.bin/electron` exists (dev symlink)
- **THEN** the binary is resolved as `~/.opencode-pets/overlay/node_modules/.bin/electron`
- **AND** `Bun.spawn()` launches it with `["."]` arg and `cwd` set to `~/.opencode-pets/overlay/`

#### Scenario: No binary found — graceful degradation

- **WHEN** `spawnOverlay()` is called
- **AND** neither the VERSION file nor the dev symlink exists
- **THEN** the plugin logs an error via `client.app.log()`
- **AND** continues without a pet (existing graceful degradation behavior preserved)

### Requirement: Wayland X11 force preserved in production

The existing `--ozone-platform=x11` flag injection for Linux Wayland sessions SHALL be preserved in production mode. When `process.platform === "linux"` and `process.env["XDG_SESSION_TYPE"] === "wayland"`, the flag SHALL be prepended to the spawn args regardless of whether the binary is the dev Electron or the production `opencode-pets-overlay`.

#### Scenario: Wayland flag in production

- **WHEN** the plugin spawns the overlay on Linux with Wayland
- **AND** the VERSION file exists (production mode)
- **THEN** the spawn args include `--ozone-platform=x11` before the app path
