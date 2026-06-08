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
plugin (Bun) ──Unix Socket IPC──► overlay (Electron)
    │                                │
    └── SSE event stream             ├── main process (window mgmt, socket server)
        from OpenCode                ├── preload (contextBridge)
                                     └── renderer (CSS spritesheet animation, speech bubble)
```

- **`packages/core`** — shared domain logic (state reducer, IPC types, config paths). Zero UI deps. Imported by plugin, overlay, and CLI.
- **`packages/plugin`** — OpenCode plugin. Hooks into SSE events, derives pet state, spawns/manages overlay process via `Bun.spawn()`.
- **`packages/overlay`** — Electron app. Transparent `BrowserWindow`, CSS spritesheet animations, Unix socket IPC server, single-instance lock.
- **`packages/cli`** — CLI for installing/managing pets (`npx opencode-pets install` etc.).

**Current state (Phase 1 MVP + Phase 2.3/2.4):** All four packages are implemented. The overlay is fully functional with Unix socket IPC and a 6-mood state machine. The main process runs a Unix domain socket IPC server (`ipc-server.ts`) that accepts JSON messages (`set_mood`, `show_bubble`, `toggle_visibility`, `set_config`, `set_pets`, `switch_pet`) and forwards them to the sandboxed renderer via Electron IPC. The preload (`bridge.cts`, CommonJS) exposes `getSpritesheetPath`, `onMoodChanged`, `onBubble`, `onConfigChanged`, `onPetsChanged`, `onSwitchPet`, `requestSwitchPet`, and `sendDragDelta` via `contextBridge`. The renderer is compiled TypeScript (`.ts` → `.js` via `tsc`) and dynamically swaps CSS animation classes in response to mood changes.

The shared core package (`@opencode-pets/core`) defines a **context-aware state machine reducer** that derives mood from active session counters (`activeStreams`, `activeTools`, `waitingPermission`) rather than static priority rules. Temporary states (`done`, `error`) expire back to the dynamically derived mood based on current counters. The plugin package (`packages/plugin/`) is fully implemented: it uses the `event` hook for SSE events plus `"tool.execute.before"` / `"tool.execute.after"` hooks for tool lifecycle, deduplicates streaming parts by `part.id`, and maps these to `PetEvent` values (`ToolRunning`, `ToolCompleted`, `StreamStarted`, `StreamEnded`, `SessionCompleted`, `TaskErrored`, `PermissionPrompted`, `PermissionResolved`, `IdleTimeout`). `Bun.spawn()` launches the overlay from `~/.opencode-pets/overlay/` (deps resolved via `bun install` in `setup-dev.sh`, Electron symlinked from monorepo). The IPC client connects via Unix socket with lazy connect, exponential backoff, message queuing, and stale-mood prevention. A `/pet` slash command toggles overlay visibility.

**Config system and pet selection (Phase 2.3/2.4)** are now implemented: cross-platform `config.json` with Zod validation, hot-reload via `fs.watch()`, atomic writes, and fallback to defaults on corruption. Pet scanning from bundled (`packages/overlay/assets/pets/`), user (`~/.opencode/pets/`), and Codex (`~/.codex/pets/`) sources with `pet.json` manifest validation, deduplication by ID with user-override priority. Runtime pet switching via `switch_pet` IPC round-trip preserves current mood. All known issues are resolved — socket shutdown hang (A), chmod startup hang (B), deployment (C–F), Linux drag (G), hasError persistence (H), and missing part guard (I) are all fixed and documented in `KNOWN-ISSUES.md`.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- Spec-driven development using OpenSpec (spec-driven schema in `openspec/`)
- Overlay renderer: vanilla TypeScript (compiled by `tsc` to vanilla JS) — no React, no Vite, no frameworks
- Electron security: `sandbox: true`, `contextIsolation: true`, no `nodeIntegration`
- Cross-platform: always abstract Unix socket / named pipe behind a common interface
- Pet spritesheet: Codex/PetDex format — 1536×1872 PNG/WebP, 8×9 grid, 192×208 px cells

## Key Files

| File                                                        | Purpose                                                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts`                                | Shared domain logic entry — re-exports types, reducer, and IPC utilities                                              |
| `packages/core/src/states.ts`                               | Pet state types — `PetMood`, `PetState`, `PetEvent`, `ALL_MOODS`                                                      |
| `packages/core/src/reducer.ts`                              | Pure-function pet state reducer with context-aware mood derivation, temp state expiry, idle timeout                   |
| `packages/core/src/ipc.ts`                                  | Shared IPC message protocol types (`IpcMessage` discriminated union) + Zod validation                                 |
| `packages/core/src/config.ts`                               | Cross-platform config directory resolution + Zod schema (`defaultPet`, `idleTimeoutMs`, `bubbleDurationMs`)          |
| `packages/core/src/pets.ts`                                 | Pet manifest Zod schema (`id`, `displayName`, `description`, `spritesheetPath`) + TypeScript types                    |
| `packages/overlay/src/main/index.ts`                        | Electron app entry — single-instance lock, macOS dock hide, socket server wiring                                      |
| `packages/overlay/src/main/window.ts`                       | `BrowserWindow` factory — transparent, frameless, always-on-top                                                       |
| `packages/overlay/src/main/ipc-server.ts`                   | Unix domain socket server — receives JSON IPC, validates, forwards to renderer                                        |
| `packages/overlay/src/preload/bridge.cts`                   | Preload bridge (CJS) — exposes `getSpritesheetPath`, `onMoodChanged`, `onBubble`, `sendDragDelta` via `contextBridge` |
| `packages/overlay/src/renderer/index.html`                  | Minimal HTML — pet `<div>`, speech bubble `<div>`                                                                     |
| `packages/overlay/src/renderer/style.css`                   | CSS `@keyframes` spritesheet animations for all 6 moods, bubble styles                                                |
| `packages/overlay/src/renderer/app.ts`                      | Renderer entry (compiled to JS) — dynamic mood-based CSS class swap, bubble control, IPC-based drag                   |
| `packages/overlay/src/renderer/types.d.ts`                  | TypeScript declarations for `window.electronAPI`                                                                      |
| `packages/overlay/scripts/copy-assets.ts`                   | Copies static renderer assets (HTML, CSS) to `dist/`                                                                  |
| `packages/overlay/scripts/test-ipc.ts`                      | Manual IPC test script — connects to socket, sends all message types                                                  |
| `packages/plugin/src/index.ts`                              | Plugin entry — composes hooks (event, tool, command), spawns overlay, manages lifecycle                               |
| `packages/plugin/src/ipc-client.ts`                         | Bun Unix socket client — lazy connect, NDJSON serialization, exponential backoff reconnection                         |
| `packages/plugin/src/state-deriver.ts`                      | SSE events → PetEvent mapping → core reducer → IPC mood sync, 30s idle timeout                                        |
| `packages/plugin/src/overlay-manager.ts`                    | `Bun.spawn()` overlay lifecycle — resolve path, spawn, kill                                                           |
| `packages/plugin/src/config.ts`                             | Config file read/write/watch with atomic writes, Zod validation, hot-reload via `fs.watch()`                           |
| `packages/plugin/src/pet-scanner.ts`                        | Pet directory scanning from bundled + user + Codex sources, `pet.json` validation, deduplication by ID               |
| `packages/plugin/scripts/setup-dev.sh`                      | Copies overlay build to `~/.opencode-pets/overlay/`, runs `bun install`, symlinks Electron                            |
| `packages/plugin/scripts/test-plugin.ts`                    | Manual test — creates IpcClient, sends mood/bubble/visibility, verifies overlay IPC                                   |
| `packages/overlay/assets/pets/claude-crab/spritesheet.webp` | Bundled default pet spritesheet (1536×1872, 8×9 grid, WebP)                                                           |
| `packages/overlay/assets/pets/claude-crab/pet.json`         | Default pet manifest (name, rows, frame counts, durations)                                                            |
| `packages/overlay/assets/pets/gutsy/spritesheet.webp`       | Bundled pet spritesheet                                                                                               |
| `packages/overlay/assets/pets/nezukocoder/spritesheet.webp` | Bundled pet spritesheet                                                                                               |
| `KNOWN-ISSUES.md`                                           | Known issues & fixed bugs — all deployment, socket, drag, and state bugs resolved                                     |
| `openspec/specs/`                                           | Main spec files — 8 capabilities covering the full MVP                                                                |

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
