# directional-drag

## Purpose

Visual feedback during drag-to-reposition. When the user drags the pet overlay, the pet's animation changes based on horizontal drag velocity: running left when dragged left quickly, running right when dragged right quickly, and returning to the current mood animation when stationary or slow.

## Requirements

### Requirement: Drag start tracking

When the user presses the mouse button on the pet element, the renderer SHALL enter drag mode and record the initial mouse position.

#### Scenario: Drag mode entered on mousedown

- **WHEN** the user presses the mouse button on the pet element
- **THEN** the renderer sets `isDragging = true`
- **AND** records `lastX = e.screenX` and `lastY = e.screenY`

### Requirement: Per-mousemove velocity calculation

During drag, on each `mousemove` event, the renderer SHALL calculate instantaneous horizontal velocity as `currentX - lastX` (in pixels per mousemove event).

#### Scenario: Velocity calculated per event

- **WHEN** the user drags the pet and a `mousemove` event fires
- **THEN** velocity is calculated as `e.screenX - lastX`
- **AND** `lastX` is updated to `e.screenX` for the next event

### Requirement: Directional CSS class swap during drag

Based on the calculated velocity, the renderer SHALL swap the pet element's CSS class:

- If velocity < -5 px/move: remove all mood classes, add `run-left`
- If velocity > 5 px/move: remove all mood classes, add `run-right`
- If -5 <= velocity <= 5: restore the current mood class (`state-{currentMood}`)

#### Scenario: Fast left drag shows run-left

- **WHEN** the user drags the pet left at velocity < -5 px/move
- **THEN** the pet element's class becomes `run-left`
- **AND** the run-left animation (row 2) plays

#### Scenario: Fast right drag shows run-right

- **WHEN** the user drags the pet right at velocity > 5 px/move
- **THEN** the pet element's class becomes `run-right`
- **AND** the run-right animation (row 1) plays

#### Scenario: Slow drag keeps mood animation

- **WHEN** the user drags the pet slowly with velocity between -5 and 5 px/move
- **THEN** the pet element retains its current mood class (e.g., `state-idle`)
- **AND** the current mood animation continues playing

#### Scenario: Velocity threshold prevents flicker

- **WHEN** the user makes tiny mouse movements during drag (velocity < 5 px/move in either direction)
- **THEN** the pet element does not switch to run-left or run-right
- **AND** the mood animation remains stable

### Requirement: Drag delta sent to main for repositioning

During drag, the renderer SHALL continue sending `sendDragDelta(dx, dy)` to the main process on each `mousemove`, where `dx = e.screenX - lastX` and `dy = e.screenY - lastY`. This existing behavior SHALL remain unchanged.

#### Scenario: Window repositioning continues during directional drag

- **WHEN** the user drags the pet with directional animation active
- **THEN** `sendDragDelta` is still sent to main on each mousemove
- **AND** the overlay window continues to follow the mouse cursor

### Requirement: Drag end restores mood

When the user releases the mouse button, the renderer SHALL exit drag mode, remove `run-left` and `run-right` classes, and restore the current mood class.

#### Scenario: Mood restored on mouseup

- **WHEN** the user releases the mouse button after dragging
- **THEN** `isDragging` becomes `false`
- **AND** `run-left` and `run-right` classes are removed
- **AND** the `state-{currentMood}` class is restored

#### Scenario: Drag end after directional drag

- **WHEN** the user was dragging left fast (run-left animation active) and releases the mouse
- **THEN** the run-left animation stops
- **AND** the pet returns to its previous mood animation (e.g., idle)

### Requirement: CSS animations for run-left and run-right

The CSS SHALL define `.run-left` and `.run-right` classes with `@keyframes` rules that animate `background-position` across the correct spritesheet rows. Row 1 SHALL be run-right; Row 2 SHALL be run-left.

#### Scenario: run-right targets row 1

- **WHEN** the `.run-right` class is applied
- **THEN** the animation cycles through row 1 of the spritesheet (columns 0-7, 8 frames)

#### Scenario: run-left targets row 2

- **WHEN** the `.run-left` class is applied
- **THEN** the animation cycles through row 2 of the spritesheet (columns 0-7, 8 frames)

#### Scenario: Run animations loop continuously

- **WHEN** the `.run-left` or `.run-right` class is applied
- **THEN** the animation loops indefinitely until the class is removed
