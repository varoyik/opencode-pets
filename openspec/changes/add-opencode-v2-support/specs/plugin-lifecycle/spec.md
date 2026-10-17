# plugin-lifecycle (delta)

## MODIFIED Requirements

### Requirement: Plugin initializes on OpenCode start

`packages/plugin/src/index.ts` SHALL default-export a dual-mode module object `{ id: "opencode-pets", server, setup }`. `server` SHALL be the async V1 plugin function conforming to `Plugin` from `@opencode-ai/plugin`; `setup` SHALL conform to the V2 `Plugin.Plugin["setup"]` signature from `@opencode/plugin`. OpenCode 1.x SHALL consume the `server` key and ignore `setup`; OpenCode 2.x SHALL decode `id` + `setup` and ignore `server`. Each loader ignores the keys it does not use.

#### Scenario: V1 server loader reads the module

- **WHEN** OpenCode 1.18.29+ loads `opencode-pets`
- **THEN** it finds `server` on the default export and invokes it with `PluginInput`
- **AND** the returned hooks object wires `config`, `event`, `tool.execute.before`, `tool.execute.after`, `command.execute.before`, and `dispose`

#### Scenario: V2 server loader reads the module

- **WHEN** OpenCode 2.x loads `opencode-pets`
- **THEN** it validates `{ id: "opencode-pets", setup }` on the default export
- **AND** invokes `setup(ctx)` with the V2 `Plugin.Context`

#### Scenario: Old V1 versions are not supported

- **WHEN** OpenCode 1.x is older than 1.18.29 (no object-entry support)
- **THEN** the plugin does not load
- **AND** `engines.opencode` declares `^1.18.29 || ^2.0.0` so the incompatibility is documented

### Requirement: Plugin calls ensureOverlayInstalled before spawning

The plugin SHALL call `ensureOverlayInstalled(log, toast)` during initialization, before any IPC client is created. The toast reporter is generation-agnostic and routes to the active `PetNotifier`. If the function returns `false` (download failed), the controller SHALL complete initialization without an IPC client or state deriver — `/pet` then reports the unavailable dialog and performs no spawn or toggle on either generation.

#### Scenario: Overlay installed — proceed to spawn

- **WHEN** the plugin initializes
- **AND** `ensureOverlayInstalled()` returns `true`
- **THEN** the controller creates the IPC client and state deriver and connects to the overlay socket

#### Scenario: Overlay download failed — graceful degradation

- **WHEN** the plugin initializes
- **AND** `ensureOverlayInstalled()` returns `false`
- **THEN** the controller initializes without an IPC client or state deriver
- **AND** SSE events and tool hooks are accepted but do nothing
- **AND** `/pet` reports the "Pet Unavailable" dialog and no error is thrown
- **AND** the V1 leg still registers the `config` hook and `command.execute.before`; the V2 leg still registers the command

## ADDED Requirements

### Requirement: Dual-mode TUI plugin module

`packages/plugin/src/tui/index.tsx` SHALL default-export `{ id: "opencode-pets", tui, setup }` where `tui` is the V1 TUI plugin function and `setup` is the V2 TUI definition setup. The V1 TUI loader SHALL consume `tui`; the V2 TUI loader SHALL consume `id` + `setup`; extra keys are ignored by both. The build SHALL emit the module as `dist/tui.js`, externalizing `@opentui/solid`.

#### Scenario: V1 TUI plugin loaded

- **WHEN** OpenCode 1.18.29+ loads the plugin's `./tui` export
- **THEN** the TUI leg registers the keymap commands `pet.show_dialog_launch`, `pet.show_dialog_toggle`, and `pet.show_dialog_error`
- **AND** each command shows the matching built-in alert with a 3-second auto-close

#### Scenario: V2 TUI plugin loaded

- **WHEN** OpenCode 2.x loads the plugin's `tui` entrypoint
- **THEN** the V2 setup subscribes to `dialog` and `toast` events on `PetsRpc` through `context.client.rpc(PetsRpc)`
- **AND** events are rendered via `context.ui.dialog.alert` (auto-closed after 3 seconds through a generation-guarded `dialog.clear()`) and `context.ui.toast.show`

#### Scenario: Pre-RPC TUI hosts stand down

- **WHEN** the early definition TUI host (OpenCode 1.18.29–1.19.3, no `client.rpc`) loads the module
- **THEN** the V2 TUI setup returns a no-op cleanup
- **AND** the V1 keymap dialogs remain the only renderer on that host

### Requirement: V2 server leg runs through the V2 plugin context

The V2 `setup(ctx)` implementation SHALL:

- construct the shared `PetController` with an RPC-backed notifier and a stderr logger,
- register `/pet` via `ctx.command.transform` as `{ name: "pet", description: "Show or hide the virtual pet overlay", execute }`, where `execute` runs the controller command flow and never sends a prompt to the model,
- register tool lifecycle hooks via `ctx.tool.hook("execute.before")` and `ctx.tool.hook("execute.after")`,
- subscribe to the event stream via `ctx.event.subscribe({ signal })` and route every event to the controller,
- register the `PetsRpc` definition via `ctx.rpc.register(PetsRpc, {})`,
- return a cleanup that aborts the subscription and disposes the controller.

When RPC registration fails, the plugin SHALL log a warning and continue with silent no-op notifications instead of failing to load.

#### Scenario: /pet on V2 spawns and reports without the LLM

- **WHEN** the user runs `/pet` on OpenCode 2.x and the overlay is not running
- **THEN** the controller spawns the overlay, sends `set_config`, `set_pets`, `set_mood`, and emits the `dialog` RPC event with the launch copy
- **AND** no model prompt is triggered

#### Scenario: RPC unavailable

- **WHEN** `ctx.rpc.register` throws
- **THEN** the plugin still loads and logs a warning
- **AND** dialog and toast notifications become silent no-ops

#### Scenario: Plugin unload cleanup

- **WHEN** OpenCode disposes the V2 plugin
- **THEN** the event subscription is aborted and the controller is disposed (overlay killed, IPC client closed, config watcher stopped)

#### Scenario: Pre-RPC transition hosts stand down

- **WHEN** OpenCode 1.18.29–1.19.3 loads the module through its early definition host (one without the RPC domain)
- **THEN** `setup` logs a debug line and returns a no-op cleanup without creating a controller
- **AND** the legacy V1 hooks remain the only active leg so no duplicate controller or overlay runs

### Requirement: Notification orchestration per generation

Notifications SHALL be sent through a `PetNotifier` abstraction implemented per generation:

- V1: dialogs via `client.tui.publish({ type: "tui.command.execute" })` targeting the `pet.show_dialog_*` keymap commands; toasts via `client.tui.showToast`.
- V2: dialogs and toasts via `PetsRpc` events (`dialog`, `toast`) emitted from the server leg and rendered by the TUI leg.

Notifier implementations SHALL never reject; all failures degrade to silent no-ops. Dialog and toast copy SHALL be shared (`src/rpc.ts`) so both generations present identical text.

#### Scenario: V1 dialog delivery

- **WHEN** the V1 controller requests the launch dialog
- **THEN** the plugin publishes `tui.command.execute` with command `pet.show_dialog_launch`

#### Scenario: V2 dialog delivery

- **WHEN** the V2 controller requests the launch dialog
- **THEN** the plugin emits `dialog` on the RPC registration with `{ title: "Pet Status", message: "Pet overlay launched." }`
- **AND** the TUI leg shows the alert when the event's location directory matches the TUI's location
