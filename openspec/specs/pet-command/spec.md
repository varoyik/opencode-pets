# pet-command

## Purpose

Self-registering `/pet` slash command that toggles the pet overlay visibility. The command SHALL be registered via the `config` hook for autocomplete and discoverability, and handled via `command.execute.before` for an instant toggle followed by a brief LLM acknowledgment.

## Requirements

### Requirement: Command registration via config hook

The plugin SHALL register the `/pet` command using the `config` hook by setting `config.command["pet"]` with a description and a minimal template. This SHALL make `/pet` visible in the OpenCode command palette with autocomplete support.

#### Scenario: Command registered on plugin load

- **WHEN** the plugin initializes and the `config` hook is called
- **THEN** the `config.command` object includes a `"pet"` entry with `{ template: "__PET_COMMAND__", description: "Show or hide the virtual pet overlay" }`

#### Scenario: Command visible in TUI palette

- **WHEN** a user types `/` in the OpenCode TUI
- **THEN** "pet" appears in the autocomplete list with description "Show or hide the virtual pet overlay"

### Requirement: /pet command handles hidden vs quit states

When the user runs the `/pet` slash command, the plugin SHALL:

- If the overlay is hidden (received `hidden` message): send `toggle_visibility` to show it
- If the overlay was quit (received `quit_pet`): spawn a new overlay process
- If the overlay is running and visible: send `toggle_visibility` to hide it

#### Scenario: /pet shows hidden overlay

- **WHEN** the overlay is hidden (received `hidden` message) and the user runs `/pet`
- **THEN** the plugin sends `toggle_visibility` to the overlay
- **AND** the overlay window becomes visible

#### Scenario: /pet respawns quit overlay

- **WHEN** the overlay was quit (received `quit_pet`) and the user runs `/pet`
- **THEN** the plugin spawns a new overlay process
- **AND** the new overlay initializes with config + pet list + mood sync

#### Scenario: /pet hides visible overlay

- **WHEN** the overlay is visible and running and the user runs `/pet`
- **THEN** the plugin sends `toggle_visibility` to the overlay
- **AND** the overlay window becomes hidden

### Requirement: Command handling via command.execute.before

The plugin SHALL implement the `command.execute.before` hook. When `input.command` equals `"pet"`, the plugin SHALL determine the correct action based on overlay state (hidden, quit, or visible), then replace the command's template parts with the confirmation message so the LLM echoes a brief acknowledgment. The overlay toggle itself happens instantly; only the optional acknowledgment goes to the LLM.

#### Scenario: User invokes /pet command

- **WHEN** a user types `/pet` and the `command.execute.before` hook fires with `input.command === "pet"`
- **THEN** the plugin determines the overlay state and takes the correct action (toggle/show/respawn), clears `output.parts`, and pushes a text part containing the confirmation message ("Pet overlay launched." or "Pet visibility toggled.")

#### Scenario: Non-pet command passes through

- **WHEN** a user types `/help` and the `command.execute.before` hook fires with `input.command === "help"`
- **THEN** the plugin does nothing — the command passes through to normal AI processing

#### Scenario: Overlay not running when /pet invoked

- **WHEN** a user types `/pet` but the overlay process is not running or has exited
- **THEN** the plugin respawns the overlay process, sends config/pets/mood, and replaces `output.parts` with the "Pet overlay launched." confirmation message

### Requirement: Command toggle is instant

The `/pet` command SHALL toggle the overlay instantly when `command.execute.before` fires, before any LLM response. The LLM may echo the confirmation message afterward, but the overlay state change itself is not blocked by AI processing.

#### Scenario: /pet toggles while AI is streaming

- **WHEN** the AI is in the middle of a long tool execution and the user types `/pet`
- **THEN** the pet visibility toggles immediately without waiting for the AI to finish
