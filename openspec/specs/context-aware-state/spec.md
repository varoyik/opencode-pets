# context-aware-state

## Purpose

Defines the context-aware mood derivation system that replaces static priority rules. The pet's mood is derived from three active session counters (`activeStreams`, `activeTools`, `waitingPermission`) rather than a fixed priority hierarchy. This capability is implemented in the core reducer and used by both plugin and overlay.

## Requirements

### Requirement: Context-aware mood derivation

The state machine SHALL derive the pet's mood from active session context instead of simple priority rules. The derivation SHALL consider three factors in order: pending permissions, active tools, and active streams.

#### Scenario: Permission pending overrides everything

- **WHEN** `waitingPermission` is `true`
- **THEN** the derived mood SHALL be `waiting`, regardless of active streams or tools

#### Scenario: Active tools show working

- **WHEN** `activeTools > 0` and `waitingPermission` is `false`
- **THEN** the derived mood SHALL be `working`

#### Scenario: Active streams show thinking

- **WHEN** `activeStreams > 0`, `activeTools === 0`, and `waitingPermission` is `false`
- **THEN** the derived mood SHALL be `thinking`

#### Scenario: No activity shows idle

- **WHEN** `activeStreams === 0`, `activeTools === 0`, and `waitingPermission` is `false`
- **THEN** the derived mood SHALL be `idle`

### Requirement: State tracking counters

The `PetState` type SHALL include three counters to track active session context: `activeStreams` (number of active text/reasoning/step-start streams), `activeTools` (number of currently executing tools), and `waitingPermission` (boolean indicating a pending permission prompt).

#### Scenario: State includes context counters

- **WHEN** a `PetState` object is created
- **THEN** it SHALL include `activeStreams: number`, `activeTools: number`, and `waitingPermission: boolean` fields

### Requirement: Temporary state expiry

Temporary moods (`done` and `error`) SHALL layer on top of the derived mood. When a temporary state expires, the mood SHALL revert to the derived mood based on current context counters, not to a static `previousMood`.

#### Scenario: Done expires back to working

- **WHEN** `done` expires and `activeTools > 0`
- **THEN** the mood reverts to `working`, not `idle`

#### Scenario: Error expires back to thinking

- **WHEN** `error` expires and `activeStreams > 0` with no active tools
- **THEN** the mood reverts to `thinking`

### Requirement: Event effects on counters

Each `PetEvent` type SHALL have a defined effect on the context counters:

| Event | activeStreams | activeTools | waitingPermission |
|-------|--------------|-------------|-------------------|
| `StreamStarted` | +1 | — | — |
| `StreamEnded` | -1 | — | — |
| `ToolRunning` | — | +1 | — |
| `ToolCompleted` | — | -1 | — |
| `PermissionPrompted` | — | — | true |
| `PermissionResolved` | — | — | false |
| `SessionCompleted` | reset to 0 | reset to 0 | false |
| `TaskErrored` | reset to 0 | reset to 0 | false |
| `IdleTimeout` | — | — | — |

#### Scenario: StreamStarted increments counter

- **WHEN** a `StreamStarted` event is processed
- **THEN** `activeStreams` SHALL increment by 1

#### Scenario: ToolCompleted decrements counter

- **WHEN** a `ToolCompleted` event is processed
- **THEN** `activeTools` SHALL decrement by 1, with a minimum value of 0

#### Scenario: SessionCompleted resets all counters

- **WHEN** a `SessionCompleted` event is processed
- **THEN** `activeStreams` SHALL become 0, `activeTools` SHALL become 0, and `waitingPermission` SHALL become `false`
