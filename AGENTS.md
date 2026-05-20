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

**Current state (Phase 1 MVP):** The overlay is fully functional. The main process passes the spritesheet path to the preload via `additionalArguments` (Electron's documented pattern for preload data). The preload (`bridge.cts`, CommonJS) reads it from `process.argv` and exposes it via `contextBridge`. The renderer is compiled TypeScript (`.ts` → `.js` via `tsc`). Static assets (`index.html`, `style.css`) are copied by `copy-assets.ts`. IPC and plugin are planned for future phases.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- Spec-driven development using OpenSpec (spec-driven schema in `openspec/`)
- Overlay renderer: vanilla TypeScript (compiled by `tsc` to vanilla JS) — no React, no Vite, no frameworks
- Electron security: `sandbox: true`, `contextIsolation: true`, no `nodeIntegration`
- Cross-platform: always abstract Unix socket / named pipe behind a common interface
- Pet spritesheet: Codex/PetDex format — 1536×1872 PNG/WebP, 8×9 grid, 192×208 px cells

## Key Files

| File                                       | Purpose                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts`               | Shared domain logic entry (placeholder)                                                        |
| `packages/overlay/src/main/index.ts`       | Electron app entry — single-instance lock, macOS dock hide, window                             |
| `packages/overlay/src/main/window.ts`      | `BrowserWindow` factory — transparent, frameless, always-on-top                                |
| `packages/overlay/src/preload/bridge.cts`  | Preload bridge (CJS) — reads spritesheet path from `process.argv`, exposes via `contextBridge` |
| `packages/overlay/src/renderer/index.html` | Minimal HTML — pet `<div>`, speech bubble `<div>`                                              |
| `packages/overlay/src/renderer/style.css`  | CSS `@keyframes` spritesheet animations, bubble styles                                         |
| `packages/overlay/src/renderer/app.ts`     | Renderer entry (compiled to JS) — loads spritesheet, starts idle                               |
| `packages/overlay/src/renderer/types.d.ts` | TypeScript declarations for `window.electronAPI`                                               |
| `packages/overlay/scripts/copy-assets.ts`  | Copies static renderer assets (HTML, CSS) to `dist/`                                           |
| `pets/code-companion/spritesheet.webp`     | Bundled default pet spritesheet (1536×1872, 8×9 grid, WebP)                                    |
| `pets/code-companion/pet.json`             | Default pet manifest (name, rows, frame counts, durations)                                     |
| `openspec/changes/overlay-foundation/`     | Current change artifacts (specs, design, tasks)                                                |

### Planned (not yet implemented)

| File                                      | Purpose                                          |
| ----------------------------------------- | ------------------------------------------------ |
| `packages/core/src/reducer.ts`            | Single source of truth for pet state transitions |
| `packages/core/src/ipc.ts`                | Shared IPC message protocol types + validation   |
| `packages/plugin/src/overlay-manager.ts`  | `Bun.spawn()` lifecycle for overlay process      |
| `packages/overlay/src/main/ipc-server.ts` | Unix socket / named pipe server                  |

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
