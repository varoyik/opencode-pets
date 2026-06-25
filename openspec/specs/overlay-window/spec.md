# overlay-window

## Purpose

Electron BrowserWindow creation, lifecycle, and security configuration for the pet overlay window. Provides a transparent, frameless, always-on-top window that never steals focus and is visible across all workspaces.

## Requirements

### Requirement: Transparent frameless window

The overlay SHALL render as a transparent, frameless window with no title bar, borders, or window chrome.

#### Scenario: Window has no chrome

- **WHEN** the overlay process starts
- **THEN** a window appears with no title bar, no borders, no minimize/maximize/close buttons, and a transparent background

#### Scenario: Window background is transparent

- **WHEN** the overlay window is visible
- **THEN** the area outside the pet sprite is fully transparent, showing the desktop beneath

### Requirement: Always-on-top visibility

The overlay window SHALL remain above all other application windows at all times.

#### Scenario: Window stays above other apps

- **WHEN** another application window is focused and brought to the foreground
- **THEN** the overlay window remains visible above the focused application window

### Requirement: Pet never steals keyboard focus

The overlay window SHALL be non-focusable, ensuring the user's keyboard input always goes to the active application.

#### Scenario: Clicking pet does not steal focus

- **WHEN** the user clicks on the pet overlay
- **THEN** keyboard focus remains with the previously focused application

### Requirement: Cross-workspace visibility

The overlay window SHALL be visible across all virtual desktops/workspaces.

#### Scenario: Pet follows across workspaces

- **WHEN** the user switches to a different virtual desktop or workspace (macOS Spaces, Linux workspaces, Windows virtual desktops)
- **THEN** the pet overlay remains visible on the new workspace

### Requirement: No taskbar or dock presence

The overlay window SHALL NOT appear in the taskbar, dock, or Alt+Tab/application switcher.

#### Scenario: Pet absent from taskbar

- **WHEN** the overlay window is visible
- **THEN** no entry for the pet appears in the taskbar (Windows), dock (macOS), or task switcher (all platforms)

### Requirement: macOS dock icon suppression

On macOS, the Electron app SHALL hide its dock icon to prevent an empty dock entry.

#### Scenario: No dock icon on macOS

- **WHEN** the overlay process starts on macOS
- **THEN** no dock icon appears for the overlay application

### Requirement: Single-instance enforcement

The overlay SHALL prevent multiple instances from running simultaneously using Electron's `app.requestSingleInstanceLock()`. The primary instance SHALL create both the BrowserWindow and the Unix socket IPC server on startup.

#### Scenario: Second instance exits immediately

- **WHEN** a second overlay process is launched while one is already running
- **THEN** the second process exits immediately without creating a new window or socket server

#### Scenario: Primary instance creates socket server

- **WHEN** the primary overlay instance starts and acquires the single-instance lock
- **THEN** it creates the BrowserWindow AND starts the Unix socket IPC server

### Requirement: Renderer sandboxing

The overlay SHALL enforce Electron security best practices: `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` on the BrowserWindow.

#### Scenario: Renderer has no Node.js access

- **WHEN** JavaScript runs in the renderer process
- **THEN** `require()`, `process`, and other Node.js APIs are not available

#### Scenario: Preload bridge is isolated

- **WHEN** the preload script runs
- **THEN** it executes in an isolated JavaScript context, separate from the renderer's global scope

### Requirement: Spritesheet path & IPC listeners via preload bridge

The preload bridge SHALL expose the spritesheet file path to the renderer via `contextBridge.exposeInMainWorld()` as a `file://` URL. The spritesheet path SHALL be passed from the main process to the preload script via Electron's `webPreferences.additionalArguments` as `--spritesheet-path=<path>`.

The preload bridge SHALL ALSO expose IPC event listeners (`onMoodChanged` and `onBubble`) to the renderer, implemented via `ipcRenderer.on()` wrapped in `contextBridge` callbacks.

#### Scenario: Renderer accesses spritesheet path

- **WHEN** the renderer calls `window.electronAPI.getSpritesheetPath()`
- **THEN** it receives a valid `file://` URL pointing to the default pet spritesheet file (bundled in `packages/overlay/assets/pets/`)

#### Scenario: Spritesheet path reaches preload via additionalArguments

- **WHEN** the BrowserWindow is created with `additionalArguments: ['--spritesheet-path=/path/to/spritesheet.webp']`
- **THEN** the preload script (`bridge.cts`, running as CommonJS in an isolated context) can read the path from `process.argv` and expose it to the renderer via `contextBridge`

#### Scenario: Renderer receives mood changes via preload

- **WHEN** the main process sends a `mood-changed` event via `webContents.send`
- **THEN** the renderer's registered `onMoodChanged` callback is invoked with the mood string

#### Scenario: Renderer receives bubble text via preload

- **WHEN** the main process sends a `show-bubble` event via `webContents.send`
- **THEN** the renderer's registered `onBubble` callback is invoked with the text string and duration number

### Requirement: Window size matches pet sprite

The overlay window SHALL be sized to fit the pet sprite (192×208 px at 1x scale) with additional height for the speech bubble area, and SHALL NOT be resizable.

#### Scenario: Window is correctly sized

- **WHEN** the overlay window appears
- **THEN** it is sized approximately 192px wide and 260px tall (sprite + bubble area) and cannot be resized by the user
