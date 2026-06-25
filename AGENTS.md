# opencode-pets

Desktop virtual pet that lives as a floating overlay, reacting in real-time to OpenCode coding sessions. **Not a standalone desktop app** — it's an OpenCode plugin that spawns and manages a lightweight Electron overlay.

## Tech Stack

- **Language:** TypeScript (100%, strict mode, ESNext target, native ESM)
- **Runtime:** Bun (runtime, package manager, IPC, process spawning)
- **Monorepo:** Bun workspaces — `packages/plugin`, `packages/overlay`, `packages/core`, `packages/cli`
- **Overlay:** Electron ^42+ (transparent frameless BrowserWindow), vanilla HTML/CSS/JS renderer
- **IPC:** Unix domain sockets (macOS/Linux) / named pipes (Windows), JSON protocol
- **Validation:** Zod (config, IPC messages, pet manifests)
- **Packaging:** electron-builder (cross-platform)

## Architecture

```
plugin (Bun) ──Socket/Named Pipe──► overlay (Electron)
    │                                │
    ├── SSE & tool hooks             ├── main process (window mgmt, socket server,
    │   from OpenCode                │     position persistence, throw physics)
    │                                ├── preload (contextBridge)
    ├── tui.publish() ──► TUI bus   └── renderer (CSS spritesheet animation,
    │   (command.execute.before           speech bubble with icons, drag inertia)
    │    hook blocks LLM via throw)
    │         │
    │         ▼
    │   TUI plugin (keymap layer)
    │   └── DialogAlert overlay
    │       (3s auto-close, Esc/OK dismiss)
    │
    └── client.tui.showToast()
        (warnings, crash alerts)
```

- **`packages/core`** — shared domain logic (state reducer, IPC types, config paths, cross-platform `getSocketPath`). Zero UI deps. Imported by plugin, overlay, and CLI.
- **`packages/plugin`** — OpenCode plugin. Hooks into SSE events and tool lifecycle hooks, derives pet state with contextual bubbles, auto-downloads overlay binary in production, spawns/manages overlay process via `Bun.spawn()`.
- **`packages/overlay`** — Electron app. Transparent frameless `BrowserWindow`, CSS spritesheet animations, named pipe / Unix socket IPC server, drag-release inertia with edge bounce, display-metrics recovery.
- **`packages/cli`** — CLI for installing/managing pets (`npx opencode-pets install` etc.).

**Current state:** All four packages are implemented. The overlay IPC is cross-platform: Unix domain sockets on macOS/Linux, named pipes on Windows — abstracted behind a shared `getSocketPath()` helper in core. The plugin uses `node:net` for Windows connections, `bun:tcp` for Unix sockets. On spawn, a connection-probe health check (TCP connect → disconnect) replaces existence checks, reliably waiting for Electron cold-start. Platform-specific `BrowserWindow` options: macOS uses `type: "panel"`, `hiddenInMissionControl`; Windows uses `thickFrame: false`, near-opaque opacity, and `"pop-up-menu"` always-on-top.

The main process runs an IPC server (`ipc-server.ts`) that accepts JSON messages (`set_mood`, `show_bubble`, `toggle_visibility`, `set_config`, `set_pets`, `switch_pet`) and forwards them to the sandboxed renderer. The preload (`bridge.cts`, CommonJS) exposes `getSpritesheetPath`, `onMoodChanged`, `onBubble`, `onConfigChanged`, `onPetsChanged`, `onSwitchPet`, `requestSwitchPet`, `sendDragDelta`, `sendDragEnd`, `onThrowEnd`, `showContextMenu`, and `onToggleBubble` via `contextBridge`. The renderer is compiled TypeScript (`.ts` → `.js` via `tsc`) and dynamically swaps CSS animation classes in response to mood changes.

**Drag and throw:** The renderer uses velocity smoothing (`VELOCITY_SMOOTHING = 0.35`) for directional run animations during drag. On release with sufficient speed, it sends `sendDragEnd(vx, vy)` to the main process, which runs a throw physics loop — friction deceleration, edge bounce with 0.6 restitution, and a stop threshold. Bubble auto-hides during drag and restores after non-throw release.

**Speech bubble:** Redesigned with a header (title + icon) and body. Mood-dependent icons: spinner for active moods (thinking/working/waiting), checkmark SVG for done, cross SVG for error. Active-mood bubbles persist until mood changes; done/error/idle bubbles auto-hide after duration. Context menu now includes a "Hide Bubble" / "Show Bubble" toggle. Bubbles are contextual per mood — tool names map to friendly phrases, reasoning text is truncated to 80 chars, permission titles are shown when waiting.

**Display metrics:** `display-metrics-changed` listener constrains the window to the primary work area when displays change. If the saved position is off-screen (disconnected display), it resets to the default position (bottom-right).

The shared core package (`@opencode-pets/core`) defines a **context-aware state machine reducer** that derives mood from active session counters (`activeStreams`, `activeTools`, `waitingPermission`) rather than static priority rules. Temporary states (`done`, `error`) expire back to the dynamically derived mood. `PetEvent` variants now carry context: `ToolRunning` has `toolName`, `PermissionPrompted` has `permissionTitle`.

**Plugin package:** Uses `event` hook for SSE events plus `"tool.execute.before"` (with tool name) / `"tool.execute.after"` hooks for tool lifecycle, deduplicates streaming parts by `part.id`. `StateDeriver` resolves contextual bubble text from tool name, reasoning text, and permission title — mapped via `TOOL_BUBBLE_MAP` to friendly messages. Bubble text updates on mood change or when context changes within the same mood (same tool switched, new reasoning text). Idle bubbles cycle through 5 phrases.

The `/pet` slash command is intercepted in `"command.execute.before"` which spawns/toggles the overlay, then uses `client.tui.publish()` to trigger a TUI plugin DialogAlert (overlaying the sentinel error that blocks the LLM), and throws `__PET_HANDLED__` to abort the command flow. A companion TUI plugin (`packages/plugin/src/tui/index.tsx`, exported as `opencode-pets/tui`) registers keymap commands `pet.show_dialog_launch` and `pet.show_dialog_toggle` that show a built-in DialogAlert with 3s auto-close and Esc/Enter dismiss.

**Config and logging:** All config operations (`readConfig`, `writeConfig`, `watchConfig`) and `IpcClient` accept an optional `LogFn` for structured logging. The plugin sends structured log entries via `client.app.log()` and toast notifications via `client.tui.showToast()` — warnings for missing pets and an error toast when the overlay crashes after reconnection exhaustion. Window position is stored in the same `opencode-pets.json` config file under the `position` key.

**Config system and pet selection:** single cross-platform `~/.config/opencode/opencode-pets.json` file (with `OPENCODE_CONFIG_DIR` and `XDG_CONFIG_HOME` overrides) validated by Zod, hot-reload via `fs.watch()`, atomic writes, fallback to defaults on corruption. Pet scanning from bundled, user, and Codex sources with `pet.json` validation, deduplication by ID with user-override priority. Runtime pet switching via `switch_pet` IPC round-trip preserves current mood. Electron runtime folders are redirected to platform-appropriate data/cache directories so they do not mix with the config file.

**Overlay auto-downloader:** On startup, `overlay-downloader.ts` checks `~/.opencode-pets/overlay/VERSION` against the plugin's `package.json` version (versioned in lockstep). If missing or mismatched, it fetches the platform-specific archive (`.tar.gz` / `.zip`) from GitHub Releases, extracts to `~/.opencode-pets/overlay/`, and writes the VERSION file. Skips in dev mode (when Electron is symlinked via `setup-dev.sh`). On failure, the plugin loads without overlay management and retries next session.

**Production vs dev overlay routing:** `spawnOverlay()` detects production mode by the presence of a VERSION file — routes to the standalone binary (`opencode-pets-overlay` on Linux, `.app` on macOS, `.exe` on Windows). In dev mode, routes to symlinked Electron via `node_modules/.bin/electron`. On Linux+Wayland, forces `--ozone-platform=x11` since native Wayland can't self-position or stay-on-top.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- Spec-driven development using OpenSpec (spec-driven schema in `openspec/`)
- Overlay renderer: vanilla TypeScript (compiled by `tsc` to vanilla JS) — no React, no Vite, no frameworks
- Electron security: `sandbox: true`, `contextIsolation: true`, no `nodeIntegration`
- Cross-platform: always abstract Unix socket / named pipe behind a common interface
- Pet spritesheet: Codex/PetDex format — 1536×1872 PNG/WebP, 8×9 grid, 192×208 px cells

## Key Files

| File                                                        | Purpose                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts`                                | Shared domain logic entry — re-exports types, reducer, IPC utilities, and `LogFn`                                                                                                                                                                              |
| `packages/core/src/states.ts`                               | Pet state types — `PetMood`, `PetState`, `PetEvent` (with `toolName`, `permissionTitle` context), `ALL_MOODS`                                                                                                                                                  |
| `packages/core/src/reducer.ts`                              | Pure-function pet state reducer with context-aware mood derivation, temp state expiry, idle timeout                                                                                                                                                            |
| `packages/core/src/ipc.ts`                                  | Shared IPC message protocol types (`IpcMessage` discriminated union) + Zod validation + cross-platform `getSocketPath()`                                                                                                                                       |
| `packages/core/src/config.ts`                               | Cross-platform config directory resolution + Zod schema (`defaultPet`, `idleTimeoutMs`, `bubbleDurationMs`)                                                                                                                                                    |
| `packages/core/src/pets.ts`                                 | Pet manifest Zod schema (`id`, `displayName`, `description`, `spritesheetPath`) + TypeScript types                                                                                                                                                             |
| `packages/overlay/src/main/index.ts`                        | Electron app entry — single-instance lock, macOS dock hide, socket server wiring                                                                                                                                                                               |
| `packages/overlay/src/main/window.ts`                       | `BrowserWindow` factory — platform-specific options, position persistence, throw physics, edge bounce, display-metrics recovery                                                                                                                                |
| `packages/overlay/src/main/ipc-server.ts`                   | Named pipe / Unix socket server — cross-platform IPC, validates, forwards to renderer, bubble toggle                                                                                                                                                           |
| `packages/overlay/src/preload/bridge.cts`                   | Preload bridge (CJS) — exposes `onThrowEnd`, `sendDragEnd`, `onToggleBubble` plus prior API via `contextBridge`                                                                                                                                                |
| `packages/overlay/src/renderer/index.html`                  | Minimal HTML — pet `<div>`, speech bubble `<div>` with header/body/icon structure                                                                                                                                                                              |
| `packages/overlay/src/renderer/style.css`                   | CSS `@keyframes` spritesheet animations for all 6 moods + run directions, bubble styles with icons/spinner                                                                                                                                                     |
| `packages/overlay/src/renderer/app.ts`                      | Renderer entry (compiled to JS) — mood-based CSS class swap, bubble with icon/toggle, drag inertia, throw release, context menu trigger                                                                                                                        |
| `packages/overlay/src/renderer/types.d.ts`                  | TypeScript declarations for `window.electronAPI` — includes `sendDragEnd`, `onThrowEnd`, `onToggleBubble`                                                                                                                                                      |
| `packages/overlay/scripts/copy-assets.ts`                   | Copies static renderer assets (HTML, CSS) to `dist/`                                                                                                                                                                                                           |
| `packages/overlay/scripts/test-ipc.ts`                      | Manual IPC test script — connects to socket, sends all message types                                                                                                                                                                                           |
| `packages/overlay/electron-builder.yml`                     | electron-builder config — standalone overlay binary for all platforms (dir target, no asar)                                                                                                                                                                    |
| `packages/plugin/src/index.ts`                              | Plugin entry — overlay-availability guard via auto-downloader, composes hooks (event, tool, command), structured logging, toast notifications, spawns overlay. `/pet` command handoff to TUI plugin via `client.tui.publish()`                                 |
| `packages/plugin/src/ipc-client.ts`                         | Cross-platform IPC client — Unix (bun:tcp) + Windows (node:net), NDJSON, exponential backoff, handshake, stale-mood prevention                                                                                                                                 |
| `packages/plugin/src/state-deriver.ts`                      | SSE events → context-enriched `PetEvent` → core reducer → IPC mood + bubble sync, 30s idle timeout, contextual bubble text                                                                                                                                     |
| `packages/plugin/src/overlay-manager.ts`                    | `Bun.spawn()` overlay lifecycle — resolve path (platform-aware, production/dev routing), connection-probe health check, spawn, kill                                                                                                                            |
| `packages/plugin/src/overlay-downloader.ts`                 | Overlay binary auto-download from GitHub Releases, version-locked with plugin, dev mode bypass, failure toast                                                                                                                                                  |
| `packages/plugin/src/config.ts`                             | Config file read/write/watch with optional `LogFn`, atomic writes, Zod validation, hot-reload via `fs.watch()`                                                                                                                                                 |
| `packages/plugin/src/pet-scanner.ts`                        | Pet directory scanning from bundled + user + Codex sources, `pet.json` validation, deduplication by ID                                                                                                                                                         |
| `packages/plugin/src/tui/index.tsx`                         | TUI plugin — registers `pet.show_dialog_launch`/`pet.show_dialog_toggle` keymap commands that show a DialogAlert (3s auto-close, Esc/Enter dismiss) to overlay the sentinel error from the `/pet` throw; `pet.show_dialog_error` for overlay-unavailable state |
| `packages/plugin/src/tui/tsconfig.json`                     | TUI plugin tsconfig — `jsx: "preserve"`, `jsxImportSource: "@opentui/solid"`, overrides root `erasableSyntaxOnly` for TSX files                                                                                                                                |
| `packages/plugin/scripts/build-tui.ts`                      | TUI plugin build script — compiles TSX → vanilla JS via `@opentui/solid/bun-plugin`, externalizes runtime packages                                                                                                                                             |
| `packages/plugin/scripts/tsconfig.json`                     | Build scripts tsconfig — extends root, `noEmit`, for LSP discovery                                                                                                                                                                                             |
| `packages/plugin/scripts/setup-dev.sh`                      | Copies overlay build to `~/.opencode-pets/overlay/`, runs `bun install`, symlinks Electron                                                                                                                                                                     |
| `packages/plugin/scripts/test-plugin.ts`                    | Manual test — creates IpcClient, sends mood/bubble/visibility, verifies overlay IPC                                                                                                                                                                            |
| `packages/overlay/assets/pets/claude-crab/spritesheet.webp` | Bundled default pet spritesheet (1536×1872, 8×9 grid, WebP)                                                                                                                                                                                                    |
| `packages/overlay/assets/pets/claude-crab/pet.json`         | Default pet manifest (name, rows, frame counts, durations)                                                                                                                                                                                                     |
| `packages/overlay/assets/pets/gutsy/spritesheet.webp`       | Bundled pet spritesheet                                                                                                                                                                                                                                        |
| `packages/overlay/assets/pets/nezukocoder/spritesheet.webp` | Bundled pet spritesheet                                                                                                                                                                                                                                        |
| `.github/workflows/release.yml`                             | CI/CD: build overlay for 5 targets (linux-x64/arm64, darwin-arm64/x64, win32-x64), compress archives, release to GitHub, publish to npm                                                                                                                        |
| `KNOWN-ISSUES.md`                                           | Known issues & fixed bugs — all deployment, socket, drag, and state bugs resolved                                                                                                                                                                              |
| `openspec/specs/`                                           | Main spec files — 10 capabilities covering the full MVP + enhanced interaction                                                                                                                                                                                 |

## Instructions

- Prioritize retrieval-led reasoning over pretrained-knowledge-led reasoning.
- When you need to ask a question, use the question tool — do not stop work to ask; continue until your task is complete.
- Use skills and MCPs whenever needed; don't ignore them (especially Context7 for docs).
- Spawn subagents when tasks are big enough to benefit from parallelism; avoid subagents for work that a single agent can complete in under ~5 minutes.
- When implementing, check ROADMAP.md for phase-level goals and architecture decisions before writing code.
- Prefer editing existing files; don't create new files unless explicitly needed.
- Keep the renderer dependency-free — no React, Vite, or any framework. Vanilla HTML/CSS/JS only.
- Shared types and logic go in `packages/core/`, never duplicated across packages.
- Always consider cross-platform implications (macOS, Linux, Windows) when designing IPC, file paths, or process management.
