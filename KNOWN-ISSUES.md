# Known Issues & Technical Debt

Issues identified during development that are not blocking the current phase
but may cause problems later. Fix them before they become surface-area bugs.

---

## Bug A: `stop()` hangs if a client is connected ✅ FIXED

**File:** `packages/overlay/src/main/ipc-server.ts` — `stop()` function.

**Fix applied:** Tracked active sockets in a `Set<net.Socket>`, destroying them in
`stop()` before calling `server.close()`. This ensures the close callback
fires immediately and the `stop()` promise resolves, even when the plugin's
socket is still open.

---

## Bug B: `chmodSync` throwing prevents `start()` from resolving ✅ FIXED

**File:** `packages/overlay/src/main/ipc-server.ts` — `start()` function.

**Fix applied:** Wrapped `fs.chmodSync()` in a try/catch inside the listen
callback. On failure, the `start()` promise is properly rejected instead of
hanging forever.

---

## Bug C: `@opencode-pets/core` module not found in deployed overlay ✅ FIXED

**File:** `packages/plugin/scripts/setup-dev.sh` — fixed via `bun install` at deploy path.

**Fix applied:** `setup-dev.sh` now replaces the `workspace:*` protocol with a `file:`
dependency pointing back to the monorepo's `packages/core`, strips `electron` from
`package.json` (to avoid Node.js v24 extract-zip bug, Electron issue #51619), runs
`bun install` for `@opencode-pets/core` + `zod` only, then symlinks `electron/` from
the monorepo and creates `node_modules/.bin/electron` pointing to the binary.
The overlay spawns via `node_modules/.bin/electron` (no `npx` overhead).

---

## Bug D: Spritesheet path resolves incorrectly in deployed overlay ✅ FIXED

**File:** `packages/overlay/src/main/window.ts` — resolved in Phase 1.7.

**Fix applied:** Spritesheets moved from monorepo root `pets/` to `packages/overlay/assets/pets/`.
Path in `window.ts` changed from `../../pets/code-companion/spritesheet.webp` to
`assets/pets/claude-crab/spritesheet.webp` — a relative path from `app.getAppPath()` that
works identically in both monorepo dev and deployed `~/.opencode-pets/overlay/`.

---

## Bug E: Health check timeout kills overlay prematurely ✅ FIXED

**File:** `packages/plugin/src/overlay-manager.ts` — `healthCheck()` timeout and `startOverlay()` kill logic.

**Fix applied:**

1. Health check timeout increased from 5s → 15s (Electron cold-start can take 5–10s).
2. `startOverlay()` no longer kills the overlay on timeout — it returns the process
   and lets the `IpcClient`'s exponential-backoff reconnection handle late socket binding.
3. `spawnOverlay()` now uses `node_modules/.bin/electron` directly instead of `npx electron .`
   for faster cold-start (no npx resolution overhead).

---

## Bug F: Bun.connect() requires `data`/`drain` callback for unix sockets ✅ FIXED

**File:** `packages/plugin/src/ipc-client.ts` — `connect()` function.

**Fix applied:** Added a no-op `data: () => {}` callback to the socket handler in
`Bun.connect()`. Bun requires at least one of `data` or `drain` callbacks for Unix
socket connections, even when the client is write-only.

---

## Bug G: Drag reposition and position persistence broken on Linux ✅ FIXED

**File:** `packages/overlay/src/renderer/style.css`, `packages/overlay/src/renderer/app.ts`, `packages/overlay/src/renderer/types.d.ts`, `packages/overlay/src/preload/bridge.cts`, `packages/overlay/src/main/window.ts`

**Fix applied:** Replaced `-webkit-app-region: drag` with IPC-based manual drag. The renderer tracks mousedown/mousemove/mouseup and sends pixel deltas via `ipcRenderer.send("drag-delta", dx, dy)`. The main process handler calls `win.setPosition()` with the delta and debounces position persistence to disk (300ms). Works on all platforms (Wayland, X11, macOS, Windows), keeps `focusable: false`, and saves position reliably without depending on the unreliable `win.on("moved")` event.

---

## Bug H: `hasError` flag persists across sessions, skips one done celebration ✅ FIXED

**File:** `packages/plugin/src/state-deriver.ts` — `hasError` flag and `session.idle` handler.

**Fix applied:** Added an auto-clear guard in `handleEvent()` after each state transition. When `hasError` is `true` but the new state is no longer in error mood and is not temporary (i.e., the error timer expired), the flag is cleared immediately. This prevents `hasError` from leaking into the next healthy session and silently skipping its done celebration.

---

## Bug I: Missing `part` undefined guard in `message.part.updated` handler ✅ FIXED

**File:** `packages/plugin/src/state-deriver.ts` — `handleSseEvent()` `message.part.updated` case.

**Fix applied:** Added a runtime `if (!part) return;` guard before accessing `part.type`. The compile-time type cast provides no runtime guarantee, and a malformed SSE event without a `part` property would have thrown a `TypeError`. The guard matches the pattern of the original defensive code that was removed during the refactor.

---

## Architectural Note: `~/.opencode-pets/overlay/` deployment model

All deployment-related bugs (C, D, E, F) are now fixed. The loose-files approach
works reliably for development:

- `setup-dev.sh` copies `dist/`, `assets/`, `package.json` → strips electron → runs `bun install` → symlinks electron + .bin
- Overlay spawns via `node_modules/.bin/electron` (no `npx` overhead)
- Health check timeout is 15s; failure is non-fatal (IPC client retries)
- Spritesheets live in `packages/overlay/assets/pets/` — same relative path works everywhere

For production distribution, consider bundling the overlay into a self-contained
Electron executable via `electron-builder`. This eliminates the install step entirely
but adds ~120MB to the package size.
