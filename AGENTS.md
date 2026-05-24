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

**Current state (Phase 1 MVP):** All four packages are implemented. The overlay is fully functional with Unix socket IPC and a 6-mood state machine. The main process runs a Unix domain socket IPC server (`ipc-server.ts`) that accepts JSON messages (set_mood, show_bubble, toggle_visibility) and forwards them to the sandboxed renderer via Electron IPC. The preload (`bridge.cts`, CommonJS) exposes `getSpritesheetPath`, `onMoodChanged`, and `onBubble` via `contextBridge`. The renderer is compiled TypeScript (`.ts` → `.js` via `tsc`) and dynamically swaps CSS animation classes in response to mood changes. The shared core package (`@opencode-pets/core`) defines the state machine reducer, IPC message types with Zod validation, and pet state types. The plugin package (`packages/plugin/`) is fully implemented: `Bun.spawn()` launches the overlay from `~/.opencode-pets/overlay/`, an IPC client connects via Unix socket, a state-deriver maps OpenCode SSE events to pet states, and a `/pet` slash command toggles overlay visibility. **Known deployment issues** (module resolution, spritesheet path, health-check timing, IPC client callback) are documented in `KNOWN-ISSUES.md` — to be resolved post-MVP.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- Spec-driven development using OpenSpec (spec-driven schema in `openspec/`)
- Overlay renderer: vanilla TypeScript (compiled by `tsc` to vanilla JS) — no React, no Vite, no frameworks
- Electron security: `sandbox: true`, `contextIsolation: true`, no `nodeIntegration`
- Cross-platform: always abstract Unix socket / named pipe behind a common interface
- Pet spritesheet: Codex/PetDex format — 1536×1872 PNG/WebP, 8×9 grid, 192×208 px cells

## Key Files

| File                                       | Purpose                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts`               | Shared domain logic entry — re-exports types, reducer, and IPC utilities                             |
| `packages/core/src/states.ts`              | Pet state types — `PetMood`, `PetState`, `PetEvent`, `ALL_MOODS`                                     |
| `packages/core/src/reducer.ts`             | Pure-function pet state reducer with priority transitions, temp state expiry, idle timeout           |
| `packages/core/src/ipc.ts`                 | Shared IPC message protocol types (`IpcMessage` discriminated union) + Zod validation                |
| `packages/overlay/src/main/index.ts`       | Electron app entry — single-instance lock, macOS dock hide, socket server wiring                     |
| `packages/overlay/src/main/window.ts`      | `BrowserWindow` factory — transparent, frameless, always-on-top                                      |
| `packages/overlay/src/main/ipc-server.ts`  | Unix domain socket server — receives JSON IPC, validates, forwards to renderer                       |
| `packages/overlay/src/preload/bridge.cts`  | Preload bridge (CJS) — exposes `getSpritesheetPath`, `onMoodChanged`, `onBubble` via `contextBridge` |
| `packages/overlay/src/renderer/index.html` | Minimal HTML — pet `<div>`, speech bubble `<div>`                                                    |
| `packages/overlay/src/renderer/style.css`  | CSS `@keyframes` spritesheet animations for all 6 moods, bubble styles                               |
| `packages/overlay/src/renderer/app.ts`     | Renderer entry (compiled to JS) — dynamic mood-based CSS class swap, bubble control                  |
| `packages/overlay/src/renderer/types.d.ts` | TypeScript declarations for `window.electronAPI`                                                     |
| `packages/overlay/scripts/copy-assets.ts`  | Copies static renderer assets (HTML, CSS) to `dist/`                                                 |
| `packages/overlay/scripts/test-ipc.ts`     | Manual IPC test script — connects to socket, sends all message types                                 |
| `packages/plugin/src/index.ts`            | Plugin entry — composes hooks (event, tool, command), spawns overlay, manages lifecycle              |
| `packages/plugin/src/ipc-client.ts`       | Bun Unix socket client — lazy connect, NDJSON serialization, exponential backoff reconnection        |
| `packages/plugin/src/state-deriver.ts`    | SSE events → PetEvent mapping → core reducer → IPC mood sync, 30s idle timeout                     |
| `packages/plugin/src/overlay-manager.ts`  | `Bun.spawn()` overlay lifecycle — resolve path, spawn, health check, kill                          |
| `packages/plugin/scripts/setup-dev.sh`    | Copies overlay build output to `~/.opencode-pets/overlay/` for local development                    |
| `packages/plugin/scripts/test-plugin.ts`  | Manual test — creates IpcClient, sends mood/bubble/visibility, verifies overlay IPC                   |
| `pets/code-companion/spritesheet.webp`     | Bundled default pet spritesheet (1536×1872, 8×9 grid, WebP)                                          |
| `pets/code-companion/pet.json`             | Default pet manifest (name, rows, frame counts, durations)                                           |
| `KNOWN-ISSUES.md`                          | Tracked bugs (socket stop hang, chmod race, deployment module resolution, spritesheet path)          |
| `openspec/changes/opencode-plugin/`        | Current change artifacts — proposal, design, specs, tasks for Phase 1.5 plugin implementation        |

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
