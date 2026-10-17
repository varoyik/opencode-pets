# pet-command (delta)

## MODIFIED Requirements

### Requirement: Command registration via config hook

On OpenCode 1.x, the plugin SHALL register the `/pet` command using the `config` hook by setting `config.command["pet"]` with a description and a minimal template (`__PET_COMMAND__`), making it visible in the command palette with autocomplete support. On OpenCode 2.x, the plugin SHALL register `/pet` through the command domain with `ctx.command.transform((editor) => editor.add({ name: "pet", description: "Show or hide the virtual pet overlay", execute }))`.

#### Scenario: Command registered on V1 plugin load

- **WHEN** the V1 plugin initializes and the `config` hook is called
- **THEN** the `config.command` object includes a `"pet"` entry with `{ template: "__PET_COMMAND__", description: "Show or hide the virtual pet overlay" }`

#### Scenario: Command registered on V2 plugin load

- **WHEN** the V2 `setup(ctx)` runs
- **THEN** the command domain receives a `"pet"` command via `ctx.command.transform` with the description "Show or hide the virtual pet overlay" and an `execute` callback

#### Scenario: Command visible in TUI palette

- **WHEN** a user types `/` in the OpenCode TUI on either generation
- **THEN** "pet" appears in the autocomplete list with description "Show or hide the virtual pet overlay"

### Requirement: Command handling via command.execute.before

On OpenCode 1.x, the plugin SHALL implement the `command.execute.before` hook. When `input.command` equals `"pet"`, the plugin SHALL run the shared controller command flow (spawn, respawn, or toggle), publish the matching `pet.show_dialog_*` TUI command so the dialog overlays the blocked command, and then throw the `__PET_HANDLED__` sentinel error to abort the command flow so the LLM never processes `/pet`.

#### Scenario: User invokes /pet command on V1

- **WHEN** a user types `/pet` and the `command.execute.before` hook fires with `input.command === "pet"`
- **THEN** the plugin determines the overlay state and takes the correct action (spawn/toggle)
- **AND** it publishes `tui.command.execute` with `pet.show_dialog_launch` or `pet.show_dialog_toggle`
- **AND** it throws an error carrying the `__PET_HANDLED__` sentinel so no prompt reaches the model

#### Scenario: Non-pet command passes through

- **WHEN** a user types `/help` and the `command.execute.before` hook fires with `input.command === "help"`
- **THEN** the plugin does nothing — the command passes through to normal AI processing

#### Scenario: Overlay not running when /pet invoked on V1

- **WHEN** a user types `/pet` but the overlay process is not running or has exited
- **THEN** the plugin respawns the overlay process, sends config/pets/mood, and reports the launch dialog

## ADDED Requirements

### Requirement: /pet on V2 executes without a model round-trip

On OpenCode 2.x, the `/pet` command's `execute` callback SHALL perform the overlay spawn/toggle flow as a pure side effect. It SHALL NOT call `ctx.session.prompt` or otherwise enter the model pipeline, and no sentinel error is used on V2 — the command never reaches the LLM because command execution is a host-side operation.

#### Scenario: /pet toggles on V2 without a message

- **WHEN** a user runs `/pet` on OpenCode 2.x
- **THEN** the overlay spawns or toggles and a `dialog` RPC event is emitted
- **AND** no user message for `/pet` enters the session and no model request is made

#### Scenario: Repeated /pet toggles visibility

- **WHEN** the overlay is running and visible and the user runs `/pet` again on OpenCode 2.x
- **THEN** the controller sends `toggle_visibility` to the overlay and emits the toggle dialog

### Requirement: Overlay-unavailable /pet feedback

When the overlay is unavailable (the automatic setup failed to download or install it), `/pet` SHALL report the shared error dialog on both generations and SHALL perform no spawn or toggle.

#### Scenario: /pet with unavailable overlay on V2

- **WHEN** the user runs `/pet` on OpenCode 2.x and the controller has no IPC client because the overlay install failed
- **THEN** the plugin emits the `dialog` RPC event with the "Pet Unavailable" copy
- **AND** no overlay process is spawned

#### Scenario: /pet with unavailable overlay on V1

- **WHEN** the user runs `/pet` on OpenCode 1.x and the controller has no IPC client because the overlay install failed
- **THEN** the plugin publishes `pet.show_dialog_error`
- **AND** still throws the `__PET_HANDLED__` sentinel
