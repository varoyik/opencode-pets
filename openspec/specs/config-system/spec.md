# config-system

## Purpose

Cross-platform configuration file management for opencode-pets. Provides a single Zod-validated `opencode-pets.json` file, automatic default creation, hot-reload via filesystem watch, and atomic writes.

## Requirements

### Requirement: Config file path follows the OpenCode plugin convention

The system SHALL resolve the config file to `opencode-pets.json` inside the OpenCode config directory. The directory SHALL be resolved in priority order:

1. `OPENCODE_CONFIG_DIR` environment variable
2. `XDG_CONFIG_HOME/opencode`
3. Platform default: `~/.config/opencode` on macOS/Linux, `%APPDATA%/opencode` on Windows

#### Scenario: macOS path resolution

- **WHEN** the plugin runs on macOS
- **THEN** the config file resolves to `$HOME/.config/opencode/opencode-pets.json`

#### Scenario: Linux path resolution

- **WHEN** the plugin runs on Linux
- **THEN** the config file resolves to `$HOME/.config/opencode/opencode-pets.json`

#### Scenario: Windows path resolution

- **WHEN** the plugin runs on Windows
- **THEN** the config file resolves to `%APPDATA%/opencode/opencode-pets.json`

### Requirement: Config schema validation

The system SHALL validate `opencode-pets.json` against a Zod schema with the following fields: `defaultPet` (string, default `"claude-crab"`), `idleTimeoutMs` (number, default `30000`), `bubbleDurationMs` (number, default `5000`), and an optional `position` object (`{ x: number, y: number }`).

#### Scenario: Valid config passes validation

- **WHEN** `opencode-pets.json` contains `{ "defaultPet": "gutsy", "idleTimeoutMs": 15000, "bubbleDurationMs": 3000 }`
- **THEN** validation succeeds and returns the parsed object

#### Scenario: Invalid config falls back to defaults

- **WHEN** `opencode-pets.json` contains invalid JSON or fails Zod validation (e.g., `idleTimeoutMs` is a string)
- **THEN** the system logs a warning, returns hardcoded defaults, and writes a fresh default config file

#### Scenario: Missing config file creates defaults

- **WHEN** no `opencode-pets.json` exists at the config path
- **THEN** the system creates the directory if needed, writes a default config file, and returns default values

### Requirement: Window position is persisted in the same config file

The system SHALL store the overlay's last window position inside the `position` field of `opencode-pets.json`. The overlay SHALL read this position on startup and write it back whenever the window is moved or thrown.

#### Scenario: Position is restored on startup

- **WHEN** `opencode-pets.json` contains `{ "position": { "x": 100, "y": 200 } }`
- **THEN** the overlay opens at coordinates `(100, 200)` (clamped to the current work area)

#### Scenario: Position is updated on drag end

- **WHEN** the user drags or throws the overlay to a new location
- **THEN** the `position` field in `opencode-pets.json` is updated atomically while preserving all other config values

### Requirement: Config hot-reload

The system SHALL watch `opencode-pets.json` for changes using `fs.watch()` and re-validate + push updated config to the overlay via `set_config` IPC message on change.

#### Scenario: Config change triggers hot-reload

- **WHEN** a user edits `opencode-pets.json` and saves it
- **THEN** the plugin detects the change, re-reads and validates the file, and sends `set_config` to the overlay with the new values

#### Scenario: Invalid config during hot-reload falls back

- **WHEN** a user saves an invalid `opencode-pets.json`
- **THEN** the plugin logs a warning, uses the previous valid config (or defaults), and does NOT send invalid config to the overlay

### Requirement: Atomic config writes

The system SHALL write config files atomically by first writing to a temporary file (`opencode-pets.json.tmp`) and then renaming it to `opencode-pets.json`.

#### Scenario: Crash during write does not corrupt config

- **WHEN** the plugin crashes while writing `opencode-pets.json.tmp`
- **THEN** the original `opencode-pets.json` remains intact and is used on next startup

### Requirement: Config values flow to correct consumers

The system SHALL ensure `idleTimeoutMs` is used by the plugin's `StateDeriver` for idle timeout duration, and `bubbleDurationMs` is sent to the overlay via `set_config` for bubble auto-dismiss timing.

#### Scenario: Idle timeout respects config

- **WHEN** `idleTimeoutMs` is set to `60000`
- **THEN** the pet transitions to `idle` mood after 60 seconds of inactivity

#### Scenario: Bubble duration respects config

- **WHEN** `bubbleDurationMs` is set to `10000`
- **THEN** speech bubbles auto-dismiss after 10 seconds
