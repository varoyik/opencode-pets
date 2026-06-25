# event-state-derivation

## Purpose

Maps OpenCode hook calls and SSE events to pet state transitions using the core reducer. The plugin SHALL use the `event` hook for SSE events, the `"tool.execute.before"` hook for tool execution start, and the `"tool.execute.after"` hook for tool completion. The state-deriver maps these to `PetEvent` values, calls the core reducer, and sends resulting mood changes to the overlay via IPC.

## Requirements

### Requirement: Event and hook subscription

The plugin SHALL implement the `event` hook that receives all v1 OpenCode SSE events, plus the `"tool.execute.before"` and `"tool.execute.after"` hooks for tool lifecycle. The `event` hook SHALL route to the state-deriver's `handleSseEvent()`, and the tool hooks SHALL call `stateDeriver.handleEvent()` directly.

#### Scenario: Tool execution triggers working state

- **WHEN** the `"tool.execute.before"` hook fires
- **THEN** `stateDeriver.handleEvent({ type: "ToolRunning" })` is called, the reducer transitions to `working`

#### Scenario: SSE event triggers state change

- **WHEN** the `event` hook receives `{ type: "permission.asked" }`
- **THEN** `stateDeriver.handleSseEvent(event)` maps it to `{ type: "PermissionPrompted" }` and calls the reducer

#### Scenario: Irrelevant SSE event ignored

- **WHEN** the `event` hook receives `{ type: "file.edited" }`
- **THEN** the state-deriver ignores it — no state change, no IPC message sent

### Requirement: Event-to-PetEvent mapping

The state-deriver SHALL map the following v1 hooks and events to `PetEvent` values defined in `@opencode-pets/core`:

| Source | PetEvent | Resulting Mood | Notes |
|--------|----------|----------------|-------|
| `"tool.execute.before"` hook | `ToolRunning` | `working` | Agent is running tools |
| `"tool.execute.after"` hook | `ToolCompleted` | derived | Decrements activeTools, re-derives mood |
| `message.part.updated` (first for part ID) | `StreamStarted` | `thinking` | Only on first event per part ID; tracks text, reasoning, and step-start parts |
| `message.part.removed` | `StreamEnded` | derived | Only when last active tracked part is removed |
| `permission.asked` | `PermissionPrompted` | `waiting` | OpenCode needs user permission |
| `permission.replied` | `PermissionResolved` | derived | Re-derives mood from counters |
| `session.error` | `TaskErrored` | `error` (temporary) | 5s error state, resets counters |
| `session.idle` | `SessionCompleted` | `done` (temporary) | 3s celebration, resets counters; skipped if error occurred this session |

**Important:** `tool.execute.before` and `tool.execute.after` are **separate hooks** on the `Hooks` interface, NOT SSE events. The v1 `Event` union does not contain them. The `session.next.*` events (v2-only) do not exist in v1; streaming detection uses `message.part.updated` with part type and delta presence instead.

#### Scenario: Tool execution triggers working state

- **WHEN** the `"tool.execute.before"` hook fires
- **THEN** `stateDeriver.handleEvent({ type: "ToolRunning" })` is called, transitions to `working`

#### Scenario: Text streaming triggers thinking state

- **WHEN** the `event` hook receives `message.part.updated` with `part.type === "text"` for a new part ID
- **THEN** `stateDeriver.handleSseEvent()` fires `StreamStarted`, transitions to `thinking`

#### Scenario: Streaming parts all removed

- **WHEN** all active text/reasoning/step-start parts are removed (`message.part.removed`)
- **THEN** `stateDeriver.handleSseEvent()` fires `StreamEnded`, re-derives mood

#### Scenario: Tool completion decrements active tools

- **WHEN** the `"tool.execute.after"` hook fires
- **THEN** `stateDeriver.handleEvent({ type: "ToolCompleted" })` is called, decrements `activeTools`

#### Scenario: Session completion triggers celebration

- **WHEN** the `event` hook receives `session.idle` and no error occurred this session
- **THEN** `stateDeriver.handleSseEvent()` fires `SessionCompleted`, transitions to `done` (temporary)

#### Scenario: Error event triggers error state

- **WHEN** the `event` hook receives `session.error`
- **THEN** `stateDeriver.handleSseEvent()` fires `TaskErrored`, transitions to `error` (temporary)

#### Scenario: Session idle after error is ignored

- **WHEN** the `event` hook receives `session.error` followed by `session.idle`
- **THEN** `TaskErrored` fires for the error, but `SessionCompleted` is skipped for the idle — the error mood persists until its 5s expiry

### Requirement: Reducer integration

The state-deriver SHALL maintain an in-memory `PetState` and call the core reducer (`reducer(currentState, event)`) for each mapped event. The reducer SHALL handle context-aware derivation, temporary state expiry, and idle timeout as defined in the `state-machine` spec.

#### Scenario: Reducer derives mood from context

- **WHEN** the current state has `activeTools: 1`, `activeStreams: 0`, `waitingPermission: false`
- **THEN** the derived mood SHALL be `working`

#### Scenario: Stream end reverts to working

- **WHEN** the current state has `activeTools: 1`, `activeStreams: 1` and a `StreamEnded` event arrives
- **THEN** the derived mood SHALL be `working` (activeTools still > 0)

### Requirement: Idle timeout

The state-deriver SHALL implement a 30-second idle timer. If no activity event is received within 30 seconds, the state-deriver SHALL send an `IdleTimeout` event to the reducer. The reducer SHALL only transition to `idle` if `activeStreams === 0`, `activeTools === 0`, and `waitingPermission === false`.

#### Scenario: No activity for 30 seconds with active tools

- **WHEN** the last activity event was more than 30 seconds ago and `activeTools > 0`
- **THEN** `IdleTimeout` is processed but the mood remains `working` (counters prevent idle)

#### Scenario: No activity for 30 seconds with no activity

- **WHEN** the last activity event was more than 30 seconds ago and all counters are 0
- **THEN** the state-deriver calls `reducer(state, { type: "IdleTimeout" })` and the pet transitions to `idle`

#### Scenario: Activity resets idle timer

- **WHEN** an activity event arrives before the 30-second timeout
- **THEN** the idle timer is reset to 30 seconds

### Requirement: IPC mood synchronization

When the reducer returns a new state with a different `mood` value, the state-deriver SHALL send a `set_mood` IPC message to the overlay via the IPC client. The message SHALL include the mood string.

#### Scenario: Mood change triggers IPC

- **WHEN** the reducer returns `{ mood: "working", previousMood: "idle" }`
- **THEN** the state-deriver sends `{ type: "set_mood", payload: { mood: "working" } }` via the IPC client

#### Scenario: Reducer returns same mood

- **WHEN** the reducer returns a state with the same mood as the current state
- **THEN** no IPC message is sent (no redundant mood updates)
