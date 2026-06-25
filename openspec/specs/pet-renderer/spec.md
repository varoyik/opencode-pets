# pet-renderer

## Purpose

Vanilla HTML/CSS/TypeScript renderer for the pet overlay. Handles spritesheet loading, CSS `@keyframes` animation, pixel-art rendering, and speech bubble display. Zero frameworks — compiled from TypeScript to vanilla JS by `tsc`.

## Requirements

### Requirement: Vanilla renderer architecture

The renderer SHALL be implemented using vanilla HTML, CSS, and TypeScript (compiled to JavaScript by `tsc`) with zero frameworks, libraries, or build tools.

#### Scenario: No framework dependencies

- **WHEN** the renderer page loads
- **THEN** no React, Vue, Vite, webpack, or any JavaScript framework or bundler is used

#### Scenario: TypeScript source compiles to vanilla JS

- **WHEN** the overlay package is built (`tsc && bun scripts/copy-assets.ts`)
- **THEN** `src/renderer/app.ts` and `src/renderer/types.d.ts` are compiled to `dist/renderer/app.js` and `dist/renderer/app.d.ts`, while `index.html` and `style.css` are copied as-is

### Requirement: Pet sprite DOM structure

The renderer SHALL contain a single `<div>` element dedicated to the pet sprite, which uses CSS `background-image` to display the spritesheet. The renderer SHALL dynamically swap the element's CSS class to change the animation state in response to `set_mood` IPC messages.

#### Scenario: Sprite element exists and uses spritesheet

- **WHEN** the renderer page loads
- **THEN** a `<div>` with the pet sprite is visible, using the spritesheet as its `background-image` via a `file://` URL

#### Scenario: Sprite class changes on mood change

- **WHEN** the renderer receives a `mood-changed` IPC event with value `"working"`
- **THEN** the pet sprite `<div>` has its class set to `"pet state-working"`, replacing any previous mood class

### Requirement: Idle animation and runtime mood switching

The renderer SHALL play the idle animation on load and SHALL support runtime animation switching for all six pet moods (idle, working, thinking, waiting, done, error). Each mood SHALL have a dedicated CSS `@keyframes` rule that cycles `background-position` across the corresponding spritesheet row.

#### Scenario: Idle animation plays on load

- **WHEN** the renderer page first loads with no IPC mood received
- **THEN** the pet sprite animates using the idle `@keyframes` (row 0, 6 frames)

#### Scenario: Working animation plays on mood change

- **WHEN** the renderer receives `mood-changed` with value `"working"`
- **THEN** the pet sprite animates using the working `@keyframes` (row 7, 6 frames)

#### Scenario: All six moods have CSS animations

- **WHEN** the CSS file is inspected
- **THEN** it contains `@keyframes` rules for `pet-idle`, `pet-working`, `pet-thinking`, `pet-waiting`, `pet-done`, and `pet-error`, each targeting the correct spritesheet row with the correct frame count

### Requirement: Pixel art rendering

The renderer SHALL use `image-rendering: pixelated` on the pet sprite element to preserve crisp pixel edges at any scale.

#### Scenario: Pixel edges are crisp

- **WHEN** the pet sprite is rendered at greater than 1x display scale
- **THEN** pixel edges remain sharp and blocky, without blurring or anti-aliasing

### Requirement: Spritesheet dimensions

The CSS SHALL define `background-size: 1536px 1872px` matching the full 8×9 grid spritesheet dimensions, with each frame cell being 192×208 px.

#### Scenario: Spritesheet sizing is correct

- **WHEN** the idle animation plays
- **THEN** each frame occupies exactly 192×208 px within the sprite element, and the animation cycles through exactly 6 columns (row 0, columns 0-5)

### Requirement: Speech bubble element

The renderer SHALL contain a `<div>` element positioned above the pet sprite, styled as a speech bubble, that can show and hide text content. The bubble SHALL be controlled via the `show_bubble` IPC message, displaying text for a configurable duration before auto-dismissing.

#### Scenario: Speech bubble exists but is hidden on load

- **WHEN** the renderer page first loads
- **THEN** a speech bubble `<div>` exists in the DOM but is not visible (has class `bubble-hidden`)

#### Scenario: Speech bubble shows text via IPC

- **WHEN** the renderer receives a `show-bubble` IPC event with text `"Running: bash"` and duration `3000`
- **THEN** the bubble becomes visible with the text `"Running: bash"` and automatically hides after 3000 milliseconds

#### Scenario: Speech bubble auto-dismisses after duration

- **WHEN** a speech bubble is displayed with a specified duration
- **THEN** after the duration elapses, the bubble hides (class `bubble-hidden` is added) without requiring additional IPC messages

#### Scenario: Speech bubble uses default duration

- **WHEN** the renderer receives a `show-bubble` event with no duration (or duration 0)
- **THEN** the bubble displays for a default duration of 5000 milliseconds

#### Scenario: New bubble replaces existing bubble

- **WHEN** the renderer receives a `show-bubble` event while a previous bubble is still visible
- **THEN** the previous bubble is immediately replaced with the new text and duration

#### Scenario: Bubble duration uses config value

- **WHEN** the renderer receives a `show-bubble` event with no duration (or duration 0) after receiving `config-changed` with `bubbleDurationMs: 10000`
- **THEN** the bubble displays for 10000 milliseconds (the configured duration)

### Requirement: Spritesheet path loading

The renderer SHALL obtain the spritesheet path from the preload bridge (`window.electronAPI.getSpritesheetPath()`) and apply it as the CSS `background-image` on the pet sprite element.

#### Scenario: Spritesheet is loaded after bridge call

- **WHEN** the renderer's JavaScript calls `getSpritesheetPath()` on DOMContentLoaded
- **THEN** the pet sprite `<div>` has its `background-image` set to the returned `file://` URL pointing to the default pet spritesheet (bundled in `packages/overlay/assets/pets/`)

#### Scenario: Spritesheet path originates from main process

- **WHEN** the overlay starts
- **THEN** the main process resolves the spritesheet path and passes it to the preload via `additionalArguments`, where the preload converts it to a `file://` URL for the renderer

### Requirement: WebP spritesheet support

The renderer SHALL support WebP-format spritesheets as CSS background images.

#### Scenario: WebP spritesheet renders correctly

- **WHEN** the spritesheet is in WebP format
- **THEN** the pet sprite renders and animates without visual artifacts

### Requirement: Config change updates bubble duration

The renderer SHALL update its bubble auto-dismiss duration when it receives a `config-changed` IPC event. The new duration SHALL apply to the next bubble shown.

#### Scenario: Bubble duration updated from config

- **WHEN** the renderer receives `config-changed` with `bubbleDurationMs: 10000`
- **THEN** the next speech bubble auto-dismisses after 10000 milliseconds

### Requirement: Pet list is stored for context menu

The renderer SHALL store the pet list received via `pets-changed` IPC event in memory for future context menu population.

#### Scenario: Pet list stored on receive

- **WHEN** the renderer receives `pets-changed` with an array of pet objects
- **THEN** the pet list is stored in a module-level variable for later access

### Requirement: Pet switch swaps spritesheet

The renderer SHALL swap the pet spritesheet when it receives a `switch-pet` IPC event with a new spritesheet path. The current mood SHALL be preserved.

#### Scenario: Spritesheet swaps on pet switch

- **WHEN** the renderer receives `switch-pet` with `"/path/to/gutsy.webp"`
- **THEN** the pet sprite's `background-image` is updated to the new path

#### Scenario: Mood preserved during pet switch

- **WHEN** the renderer receives `switch-pet` while the current mood class is `"state-working"`
- **THEN** the spritesheet changes but the `"state-working"` class remains, so the working animation continues on the new pet

### Requirement: Context menu event handling

The renderer SHALL listen for the `contextmenu` event on the pet element, call `preventDefault()` to suppress the default browser menu, and invoke `window.electronAPI.showContextMenu()` to request the main process display the native context menu.

#### Scenario: Right-click triggers native menu

- **WHEN** the user right-clicks on the pet element
- **THEN** the default browser context menu does not appear
- **AND** `window.electronAPI.showContextMenu()` is called
- **AND** the main process displays the native Electron context menu

### Requirement: Current mood tracking

The renderer SHALL track the current mood in a module-level variable, updated whenever `onMoodChanged` fires. This value SHALL be used to restore the correct mood class after drag ends.

#### Scenario: Mood stored on change

- **WHEN** the renderer receives `mood-changed` with value `"working"`
- **THEN** a module-level `currentMood` variable is set to `"working"`

### Requirement: Directional class swap during drag

During `mousemove` while `isDragging` is true, the renderer SHALL:

1. Calculate `velocity = e.screenX - lastX`
2. If `velocity < -5`: remove all `state-*` classes, add `run-left`
3. If `velocity > 5`: remove all `state-*` classes, add `run-right`
4. Otherwise: remove `run-left` and `run-right`, add `state-{currentMood}`
5. Send `sendDragDelta(dx, dy)` to main (existing behavior for window repositioning)
6. Update `lastX` and `lastY`

#### Scenario: Directional class swap

- **WHEN** the user drags the pet left at velocity < -5 px/move
- **THEN** the pet element class becomes `run-left`
- **AND** all `state-*` classes are removed

#### Scenario: Mood restoration during slow drag

- **WHEN** the user drags slowly with velocity between -5 and 5 px/move
- **THEN** `run-left` and `run-right` are removed
- **AND** `state-{currentMood}` is added

### Requirement: Drag end restores mood

On `mouseup`, the renderer SHALL set `isDragging = false`, remove `run-left` and `run-right` classes, and restore `state-{currentMood}`.

#### Scenario: Clean drag end

- **WHEN** the user releases the mouse button after dragging
- **THEN** `isDragging` becomes `false`
- **AND** `run-left` and `run-right` classes are removed
- **AND** `state-{currentMood}` is restored

### Requirement: Existing drag behavior preserved

The existing drag-to-reposition behavior (sending `sendDragDelta` on mousemove for `win.setPosition()`) SHALL continue to work unchanged. The directional animation is additive and does not interfere with window repositioning.

#### Scenario: Window still follows mouse

- **WHEN** the user drags the pet with directional animation active
- **THEN** the overlay window continues to follow the mouse cursor
- **AND** the directional animation plays simultaneously
