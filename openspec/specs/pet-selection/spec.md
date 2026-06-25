# pet-selection

## Purpose

Runtime pet selection infrastructure. Scans multiple pet sources, validates manifests, deduplicates by ID, and enables switching pets without restarting the overlay.

## Requirements

### Requirement: Pet scanning from multiple sources

The system SHALL scan for pets in three sources, in priority order: (1) bundled pets at `packages/overlay/assets/pets/`, (2) user pets at `~/.opencode/pets/`, (3) Codex compatibility pets at `~/.codex/pets/`.

#### Scenario: Bundled pets are always available

- **WHEN** the plugin starts
- **THEN** bundled pets from the overlay package are included in the pet list

#### Scenario: User pets are discovered

- **WHEN** `~/.opencode/pets/` exists and contains valid pet directories
- **THEN** those pets are added to the pet list

#### Scenario: Codex pets are discovered

- **WHEN** `~/.codex/pets/` exists and contains valid pet directories
- **THEN** those pets are added to the pet list

### Requirement: Pet manifest validation

Each pet directory SHALL contain a `pet.json` file validated against a Zod schema with fields: `id` (string, required), `displayName` (string, required), `description` (string, optional), `spritesheetPath` (string, required). The referenced spritesheet file SHALL exist.

#### Scenario: Valid pet is included

- **WHEN** a pet directory contains a valid `pet.json` and the referenced spritesheet exists
- **THEN** the pet is added to the available pet list

#### Scenario: Invalid pet.json is skipped

- **WHEN** a pet directory contains an invalid `pet.json` (missing required fields or invalid JSON)
- **THEN** the pet is skipped, a warning is logged, and scanning continues

#### Scenario: Missing spritesheet is skipped

- **WHEN** a pet directory has a valid `pet.json` but the referenced spritesheet does not exist
- **THEN** the pet is skipped, a warning is logged, and scanning continues

#### Scenario: Directories without pet.json are skipped

- **WHEN** a subdirectory in a pet scan path does not contain `pet.json`
- **THEN** it is silently skipped (no warning)

### Requirement: Pet deduplication by ID

The system SHALL deduplicate pets by `id`. If the same `id` appears in multiple sources, the higher-priority source wins: user pets override bundled pets, and `~/.opencode/pets/` overrides `~/.codex/pets/`.

#### Scenario: User pet overrides bundled pet

- **WHEN** a user-installed pet has `id` `"claude-crab"` matching a bundled pet
- **THEN** the user pet is used and the bundled pet is discarded

### Requirement: Pet list sync to overlay

The plugin SHALL send the full pet list to the overlay via `set_pets` IPC message on connect and whenever the pet list changes.

#### Scenario: Pet list sent on connect

- **WHEN** the IPC client connects to the overlay
- **THEN** the plugin sends `set_pets` with the current available pet list

#### Scenario: Empty user directories still send bundled pets

- **WHEN** `~/.opencode/pets/` exists but is empty
- **THEN** `set_pets` is still sent with only bundled pets

### Requirement: Runtime pet switching

The system SHALL support switching pets at runtime via the `switch_pet` IPC message. The overlay sends `switch_pet` to the plugin; the plugin validates the pet ID, resolves the spritesheet path, and sends `switch_pet` back to the overlay with the resolved path. The overlay swaps the spritesheet while preserving the current mood.

#### Scenario: Valid pet switch

- **WHEN** the overlay sends `switch_pet` with a valid `petId`
- **THEN** the plugin resolves the spritesheet path and sends it back; the overlay swaps the spritesheet and keeps the current mood

#### Scenario: Invalid pet ID is rejected

- **WHEN** the overlay sends `switch_pet` with an unknown `petId`
- **THEN** the plugin logs a warning and does not send a response; the overlay continues with the current pet

#### Scenario: Pet switch preserves mood

- **WHEN** the pet is switched while the current mood is `"working"`
- **THEN** the new pet's spritesheet loads and the `"working"` animation continues without interruption
