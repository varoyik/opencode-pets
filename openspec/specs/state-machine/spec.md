# state-machine

## Purpose

Pure-function pet state reducer in `packages/core`. Defines the six core moods, context-aware mood derivation from session counters, temporary state auto-expiry, and idle timeout logic. Shared between plugin and overlay — no UI dependencies.

## Requirements

### Requirement: Pure function reducer

The state machine SHALL be implemented as a pure function `reducer(state: PetState, event: PetEvent): PetState` that takes the current pet state and an event, and returns a new pet state. The reducer SHALL be stateless and side-effect-free.

#### Scenario: Reducer returns new state for valid transition

- **WHEN** the reducer is called with `{ mood: "idle", previousMood: "idle", activeStreams: 0, activeTools: 0, waitingPermission: false }` and a `StreamStarted` event
- **THEN** it returns `{ mood: "thinking", previousMood: "idle", activeStreams: 1, activeTools: 0, waitingPermission: false }`

#### Scenario: Reducer returns same state for no-op event

- **WHEN** the reducer is called with `{ mood: "working", activeTools: 1 }` and an `IdleTimeout` event
- **THEN** it returns the original state unchanged (activeTools prevents idle)

### Requirement: Six core moods

The state machine SHALL support six pet moods: `idle`, `working`, `thinking`, `waiting`, `done`, and `error`. Each mood SHALL map to a specific spritesheet row for animation.

#### Scenario: All six moods are valid values

- **WHEN** the `PetMood` type is defined
- **THEN** it includes exactly `"idle"`, `"working"`, `"thinking"`, `"waiting"`, `"done"`, and `"error"`

### Requirement: Context-aware derivation rules

The state machine SHALL derive the mood from active session context using the following ordered rules:

1. If `waitingPermission` is `true` → `waiting`
2. Else if `activeTools > 0` → `working`
3. Else if `activeStreams > 0` → `thinking`
4. Else → `idle`

Temporary states (`done` and `error`) SHALL override the derived mood while active.

#### Scenario: Permission pending overrides active tools

- **WHEN** the state has `activeTools: 2`, `waitingPermission: true`
- **THEN** the derived mood SHALL be `waiting`

#### Scenario: Active tools override active streams

- **WHEN** the state has `activeStreams: 1`, `activeTools: 1`, `waitingPermission: false`
- **THEN** the derived mood SHALL be `working`

#### Scenario: Active streams show thinking

- **WHEN** the state has `activeStreams: 1`, `activeTools: 0`, `waitingPermission: false`
- **THEN** the derived mood SHALL be `thinking`

#### Scenario: No activity shows idle

- **WHEN** the state has `activeStreams: 0`, `activeTools: 0`, `waitingPermission: false`
- **THEN** the derived mood SHALL be `idle`

### Requirement: Temporary states auto-expire

The `done` and `error` moods SHALL be temporary states that auto-expire after a set duration. Upon expiry, the state SHALL revert to the derived mood based on current context counters, not to a static `previousMood`. Temporary states SHALL include a `temporary: true` flag and an `expiresAt` timestamp.

#### Scenario: Done expires back to working

- **WHEN** the current state is `{ mood: "done", activeTools: 1, temporary: true, expiresAt: <future> }`
- **THEN** after `expiresAt` passes, the next reducer call returns `{ mood: "working", previousMood: "done", activeTools: 1 }`

#### Scenario: Error expires back to idle

- **WHEN** the current state is `{ mood: "error", activeStreams: 0, activeTools: 0, temporary: true, expiresAt: <future> }`
- **THEN** after `expiresAt` passes, the next reducer call returns `{ mood: "idle", previousMood: "error" }`

### Requirement: Idle timeout

The state machine SHALL define an `IdleTimeout` event that, when no other events have occurred for 30 seconds, resets the state to `idle` ONLY if `activeStreams === 0`, `activeTools === 0`, and `waitingPermission === false`. If any counter is non-zero, the state SHALL remain unchanged.

#### Scenario: Idle timeout resets to idle from thinking

- **WHEN** the current state is `{ mood: "thinking", activeStreams: 0, activeTools: 0, waitingPermission: false }` and an `IdleTimeout` event fires
- **THEN** the state transitions to `{ mood: "idle", previousMood: "thinking" }`

#### Scenario: Idle timeout is no-op when tools are active

- **WHEN** the current state is `{ mood: "working", activeTools: 1 }`
- **THEN** an `IdleTimeout` event returns the state unchanged

#### Scenario: Idle timeout is no-op when already idle

- **WHEN** the current state is `{ mood: "idle", previousMood: "idle" }`
- **THEN** an `IdleTimeout` event returns the state unchanged

### Requirement: Event type definitions

The state machine SHALL define the following event types: `ToolRunning`, `ToolCompleted`, `StreamStarted`, `StreamEnded`, `SessionCompleted`, `TaskErrored`, `PermissionPrompted`, `PermissionResolved`, and `IdleTimeout`. Each event type SHALL have a defined effect on context counters and mood derivation.

#### Scenario: All events have defined transitions

- **WHEN** each event type is passed to the reducer with a valid initial state
- **THEN** the reducer returns a deterministic result (either a state change or the same state based on context)

#### Scenario: ToolRunning increments activeTools

- **WHEN** a `ToolRunning` event is processed with `activeTools: 0`
- **THEN** the returned state has `activeTools: 1` and mood `working`

#### Scenario: ToolCompleted decrements activeTools

- **WHEN** a `ToolCompleted` event is processed with `activeTools: 1`, `activeStreams: 0`
- **THEN** the returned state has `activeTools: 0` and mood `idle`

#### Scenario: SessionCompleted resets counters

- **WHEN** a `SessionCompleted` event is processed with `activeTools: 2`, `activeStreams: 1`
- **THEN** the returned state has `activeTools: 0`, `activeStreams: 0`, and mood `done` (temporary)

#### Scenario: SessionCompleted preserves error

- **WHEN** a `SessionCompleted` event is processed while the current mood is `error` (temporary)
- **THEN** the returned state preserves `mood: "error"` and does not transition to `done`
