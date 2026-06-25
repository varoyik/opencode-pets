# context-menu

## Purpose

Native Electron right-click context menu on the pet overlay. Provides intuitive access to Switch Pet, Hide Pet, and Quit Pet actions. Built with `Menu.buildFromTemplate()` in the main process for OS-native look and feel.

## Requirements

### Requirement: Context menu triggered on right-click

The renderer SHALL detect the `contextmenu` event on the pet element, call `preventDefault()` to suppress the browser default menu, and send an IPC message to the main process to show the native context menu.

#### Scenario: Right-click shows native menu

- **WHEN** the user right-clicks on the pet overlay
- **THEN** the browser default context menu is suppressed
- **AND** a native Electron context menu appears near the cursor

#### Scenario: Context menu works in sandboxed renderer

- **WHEN** the renderer runs with `sandbox: true`
- **THEN** the `contextmenu` event is still detectable via `window.addEventListener` or element event listener
- **AND** `preventDefault()` prevents the default browser menu
- **AND** `ipcRenderer.send('show-context-menu')` reaches the main process

### Requirement: Menu items and structure

The context menu SHALL contain exactly three top-level items: "Switch Pet →" (submenu), "Hide Pet", and "Quit Pet", separated by a horizontal rule between "Switch Pet" and "Hide Pet".

#### Scenario: Menu structure matches spec

- **WHEN** the context menu is displayed
- **THEN** it contains "Switch Pet" with a submenu indicator, followed by a separator, followed by "Hide Pet" and "Quit Pet"

#### Scenario: Menu labels are in English

- **WHEN** the context menu is displayed
- **THEN** all labels are in English: "Switch Pet", "Hide Pet", "Quit Pet"

### Requirement: Switch Pet submenu

The "Switch Pet" submenu SHALL list all available pets received via the `set_pets` IPC message. The currently active pet SHALL be indicated with a checkmark (`checked: true`). Clicking a pet name SHALL trigger a pet switch via the existing `switch_pet` IPC round-trip.

#### Scenario: Submenu lists all pets

- **WHEN** the context menu is opened
- **THEN** the "Switch Pet" submenu contains all pets from the `set_pets` message, in the order received

#### Scenario: Current pet has checkmark

- **WHEN** the current pet is "claude-crab"
- **THEN** the "Claude Crab" submenu item has a checkmark (or platform equivalent)
- **AND** all other pet items do not have a checkmark

#### Scenario: Clicking pet name triggers switch

- **WHEN** the user clicks "Gutsy" in the Switch Pet submenu
- **THEN** the overlay sends `switch_pet` with `{ petId: "gutsy" }` to the plugin
- **AND** the plugin resolves the path and sends back `switch_pet` with the resolved spritesheet path
- **AND** the overlay renderer updates the spritesheet while preserving the current mood

### Requirement: Hide Pet action

Clicking "Hide Pet" SHALL hide the overlay window (`win.hide()`) and send a `hidden` message to the plugin via the Unix socket.

#### Scenario: Hide Pet hides overlay

- **WHEN** the user clicks "Hide Pet"
- **THEN** the overlay window becomes hidden
- **AND** the plugin receives a `hidden` message

#### Scenario: Hidden overlay shown again via /pet

- **WHEN** the overlay is hidden and the user runs the `/pet` command in OpenCode
- **THEN** the plugin sends `toggle_visibility` to the overlay
- **AND** the overlay window becomes visible again

### Requirement: Quit Pet action

Clicking "Quit Pet" SHALL send a `quit_pet` message to the plugin via the Unix socket, then gracefully exit the Electron app (`app.quit()`).

#### Scenario: Quit Pet exits overlay

- **WHEN** the user clicks "Quit Pet"
- **THEN** the plugin receives a `quit_pet` message
- **AND** the overlay process exits

#### Scenario: Plugin stops managing after quit

- **WHEN** the plugin receives `quit_pet`
- **THEN** it stops attempting to reconnect to or respawn the overlay
- **AND** the overlay remains absent until the user runs `/pet` again

#### Scenario: /pet respawns after quit

- **WHEN** the overlay was quit and the user runs `/pet`
- **THEN** the plugin spawns a new overlay process
- **AND** the new overlay initializes normally with config + pet list + mood sync

### Requirement: Menu is rebuilt on each show

The context menu SHALL be rebuilt from template each time it is shown, ensuring the current pet checkmark and pet list are always up to date.

#### Scenario: Menu reflects current state

- **WHEN** the user switches pets via the context menu, then right-clicks again
- **THEN** the new current pet has the checkmark
- **AND** the previously checked pet no longer has a checkmark
