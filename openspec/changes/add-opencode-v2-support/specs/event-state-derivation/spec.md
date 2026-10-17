# event-state-derivation (delta)

## MODIFIED Requirements

### Requirement: Event and hook subscription

The plugin SHALL receive session activity from generation-appropriate sources and route it into one shared state deriver:

- **OpenCode 1.x**: the `event` hook receives all V1 SSE events and routes them to `handleSseEvent()`; the `"tool.execute.before"` and `"tool.execute.after"` hooks call `handleToolRunning()` / `handleToolCompleted()`.
- **OpenCode 2.x**: `ctx.event.subscribe({ signal })` is consumed in an async loop that routes every event to `handleSseEvent()`; `ctx.tool.hook("execute.before")` and `ctx.tool.hook("execute.after")` drive the tool lifecycle.

#### Scenario: Tool execution triggers working state

- **WHEN** the tool execution hook fires on either generation
- **THEN** the deriver receives `{ type: "ToolRunning", toolName }` and the reducer transitions to `working`

#### Scenario: SSE event triggers state change

- **WHEN** the event stream delivers `permission.asked` (any generation)
- **THEN** `handleSseEvent(event)` maps it to `{ type: "PermissionPrompted" }` and calls the reducer

#### Scenario: Irrelevant SSE event ignored

- **WHEN** the event stream delivers `{ type: "file.edited" }`
- **THEN** the state-deriver ignores it — no state change, no IPC message sent

#### Scenario: V2 stream subscription delivers events

- **WHEN** the V2 plugin runs and the session emits `session.step.started`
- **THEN** the subscription loop forwards the event to `handleSseEvent()` and the pet enters `thinking`

### Requirement: Event-to-PetEvent mapping

The state-deriver SHALL map the following hooks and events to `PetEvent` values defined in `@opencode-pets/core`:

| Source | PetEvent | Resulting Mood | Notes |
|--------|----------|----------------|-------|
| tool execution hook (V1 and V2) | `ToolRunning` | `working` | Agent is running tools |
| tool completion hook (V1 and V2) | `ToolCompleted` | derived | Decrements activeTools, re-derives mood |
| `message.part.updated` (V1 classic) | `StreamStarted` | `thinking` | Only on first event per part ID; text, reasoning, and step-start parts |
| `message.part.removed` (V1 classic) | `StreamEnded` | derived | Only when the last tracked part is removed |
| `session.step.started` / `session.step.ended` (V2) | `StreamStarted` / `StreamEnded` | `thinking` / derived | Tracked per stream key |
| `session.text.started` / `session.text.ended` (V2) | `StreamStarted` / `StreamEnded` | `thinking` / derived | Tracked per stream key |
| `session.reasoning.started` / `ended` (V2) | `StreamStarted` / `StreamEnded` | `thinking` / derived | `ended` stores the authoritative text |
| `session.reasoning.delta` (V2) | — | — | Accumulates text and refreshes the thinking bubble |
| `permission.asked` (classic and V2) | `PermissionPrompted` | `waiting` | V2 reads `action ?? permission` for the title |
| `permission.replied` (classic and V2) | `PermissionResolved` | derived | Re-derives mood from counters |
| `session.error` (classic) / `session.step.failed` / `session.execution.failed` (V2) | `TaskErrored` | `error` (temporary) | Resets session counters |
| `session.idle` (classic and V2) / idle `session.status` (V2) | `SessionCompleted` | `done` (temporary) | Skipped if an error occurred this session |

#### Scenario: Text streaming triggers thinking state

- **WHEN** a text stream starts (V1 `message.part.updated` for a new part, or V2 `session.text.started`)
- **THEN** the deriver fires `StreamStarted` and the pet enters `thinking`

#### Scenario: Streaming parts all released

- **WHEN** every tracked stream part is released (`message.part.removed`, or the V2 `*.ended` variants)
- **THEN** the deriver fires `StreamEnded` and re-derives mood

#### Scenario: Tool completion decrements active tools

- **WHEN** the tool completion hook fires on either generation
- **THEN** the deriver receives `{ type: "ToolCompleted" }` and decrements `activeTools`

#### Scenario: Session completion triggers celebration

- **WHEN** a session-idle signal arrives (V1/V2 `session.idle` or idle `session.status`) and no error occurred this session
- **THEN** the deriver fires `SessionCompleted` and the pet enters `done` (temporary)

#### Scenario: Error event triggers error state

- **WHEN** an error event arrives (`session.error` on V1, `session.step.failed` or `session.execution.failed` on V2)
- **THEN** the deriver fires `TaskErrored` and the pet enters `error` (temporary)

#### Scenario: Session idle after error is ignored

- **WHEN** an error event is followed by a session-idle signal
- **THEN** `TaskErrored` fires for the error, but `SessionCompleted` is skipped — the error mood persists until expiry

## ADDED Requirements

### Requirement: Cross-generation event payloads and names

`handleSseEvent` SHALL read the event payload from `properties` when present, falling back to `data` (V1 `session.next.*` and V2 events carry it under `data`). Event names SHALL be normalized before dispatch: `session.next.*` maps to `session.*` and `permission.v2.*` maps to `permission.*`. Events in the V2 set SHALL be dispatched to the V2 handler; all other events SHALL go to the classic handler.

#### Scenario: 1.18 session.next event carries data

- **WHEN** OpenCode 1.18 delivers `session.next.step.started` with a `data` payload
- **THEN** the deriver normalizes the name to `session.step.started` and handles the payload from `data`

#### Scenario: Classic event carries properties

- **WHEN** a classic event arrives with its payload under `properties`
- **THEN** the deriver handles that payload unchanged

### Requirement: Generation latch prevents double counting

OpenCode 1.18 emits both classic and V2 events for the same activity. The deriver SHALL latch into V2 generation mode when it receives a raw event whose type belongs to a V2-only family (`session.next.*`, `session.step.*`, `session.text.*`, `session.reasoning.*`, `session.execution.*`, `session.tool.*`). While latched, classic `message.part.updated` and `message.part.removed` events SHALL be ignored. If classic stream parts were tracked before latching, they SHALL be cleared and a single `StreamEnded` SHALL be emitted so `activeStreams` does not stay latched.

#### Scenario: Dual-emission session counts streams once

- **WHEN** OpenCode 1.18 emits classic `message.part.updated` followed by `session.next.text.started` for the same activity
- **THEN** the deriver latches to V2 mode, releases any classic part state, and tracks the V2 stream instead

#### Scenario: Classic-only sessions never latch

- **WHEN** a session runs on OpenCode ≤ 1.17 and only classic events are delivered
- **THEN** the deriver stays in classic mode — `session.idle` and `permission.*` do not latch generation mode on their own

### Requirement: V2 stream identity and reasoning bubbles

The deriver SHALL key V2 stream parts as `` `${assistantMessageID}:${kind}:${ordinal ?? textID ?? reasoningID ?? callID ?? id ?? ""}` `` so events from different messages or kinds never collide. A `StreamEnded` SHALL be emitted only when the last tracked part is released. `session.reasoning.delta` SHALL accumulate reasoning text and refresh the thinking bubble; `session.reasoning.ended` SHALL prefer the authoritative `text` when present.

#### Scenario: Interleaved text and step streams

- **WHEN** a `session.text.started` stream and a `session.step.started` stream are active and only the text stream ends
- **THEN** the pet stays `thinking` until the step stream also ends

#### Scenario: Reasoning delta refreshes the bubble

- **WHEN** `session.reasoning.delta` arrives while the pet is `thinking`
- **THEN** the accumulated reasoning text (truncated to 80 chars) is sent to the overlay as the bubble text
