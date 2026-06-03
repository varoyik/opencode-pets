# Known Issues & Technical Debt

Issues identified during development that are not blocking the current phase
but may cause problems later. Fix them before they become surface-area bugs.

---

## Bug A: `stop()` hangs if a client is connected

**File:** `packages/overlay/src/main/ipc-server.ts` — `stop()` function (line 134)

**Problem:** `server.close()` only stops accepting _new_ connections. If a
plugin has an active socket connection when the overlay shuts down, the close
callback never fires, `resolve()` is never called, and `app.quit()` never runs.
The app hangs on shutdown.

**Trace:**

1. Plugin connects to the Unix socket
2. Electron starts shutting down → `before-quit` → `server.stop()`
3. `server.close()` waits for all connections to end
4. The plugin's socket stays open → callback never fires
5. `stop()` Promise never resolves → `app.quit()` dead lettered

**Fix:** Track active client sockets in a `Set<net.Socket>`, destroy them in
`stop()` before calling `server.close()`:

```
const sockets = new Set<net.Socket>();
server = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  // ...
});
// In stop():
for (const socket of sockets) socket.destroy();
server.close(() => { ... });
```

---

## Bug B: `chmodSync` throwing prevents `start()` from resolving

**File:** `packages/overlay/src/main/ipc-server.ts` — `start()` function (line 115-119)

**Problem:** If `fs.chmodSync(socketPath, 0o600)` throws (permissions,
filesystem, or path issue), `resolve()` is never called, and the `start()`
promise never settles. `await server.start()` hangs forever, blocking app
startup.

**Trace:**

1. `server.listen(socketPath, callback)` fires callback on success
2. `fs.chmodSync(socketPath, 0o600)` throws
3. `resolve()` is skipped — promise never settles
4. `index.ts` line 24: `await server.start()` hangs

**Fix:** Wrap chmod in try/catch, reject on failure:

```
server.listen(socketPath, () => {
  try {
    fs.chmodSync(socketPath, 0o600);
  } catch (err) {
    reject(err);
    return;
  }
  resolve();
});
```

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

## Bug G: Drag reposition and position persistence broken on Linux

**File:** `packages/overlay/src/renderer/style.css` (`-webkit-app-region: drag`) + `packages/overlay/src/main/window.ts` (`win.on("moved")` + `focusable`)

**Problem:** Two separate issues:

1. **Drag doesn't work on Wayland** — `-webkit-app-region: drag` is a Chromium API that relies on the X11 window manager protocol. On Wayland compositors (Hyprland, etc.), this API doesn't register with the compositor, so clicks on the pet do nothing — the window can't be moved.

2. **Drag works poorly on Linux X11** — Even on X11, Electron requires `focusable: true` for `-webkit-app-region: drag` to function. But setting `focusable: true` makes the overlay steal keyboard focus from the user's editor/terminal — defeating the "pet shouldn't steal focus" design goal.

3. **Position persistence never saves** — `win.on("moved")` relies on the window manager reporting position changes back to Electron. On many Linux WMs (both Wayland and X11), this event either fires late or never fires at all, so the position file at `~/.config/opencode-pets/position.json` is never written. On next launch, there's nothing to restore, and the pet resets to the default position.

**Trace (drag + persistence failure on Wayland):**

1. `style.css` sets `-webkit-app-region: drag` on `#pet`
2. User clicks and drags the pet
3. Wayland compositor doesn't understand `-webkit-app-region` — no drag starts
4. `win.on("moved")` never fires
5. `mkdirSync + writeFileSync` in the handler never executes
6. `~/.config/opencode-pets/position.json` is never created
7. On next launch, `existsSync(POSITION_FILE)` is `false` — pet appears at default position

**Fix:** Replace `-webkit-app-region: drag` with IPC-based manual drag in the renderer:

```
Renderer:                           Main Process:
  mousedown on #pet                  ipcMain.on("drag-delta")
    → start tracking                   → win.setPosition(x+dx, y+dy)
  mousemove                           → save position to file
    → sendDragDelta(dx, dy) ──────►
  mouseup
    → stop tracking
```

This approach:

- Works on all platforms (Wayland, X11, macOS, Windows) — no WM dependency
- Keeps `focusable: false` — pet never steals keyboard focus
- Saves position synchronously after each `setPosition()` — no `moved` event dependency
- Can be debounced (e.g., save every 300ms) to avoid thrashing the filesystem during fast drags

**Files to change:**

- `packages/overlay/src/preload/bridge.cts` — expose `sendDragDelta(dx, dy)` via `ipcRenderer.send()`
- `packages/overlay/src/renderer/types.d.ts` — add `sendDragDelta` to the `IElectronAPI` type
- `packages/overlay/src/renderer/app.ts` — add mousedown/mousemove/mouseup drag handlers
- `packages/overlay/src/renderer/style.css` — remove `-webkit-app-region: drag` from `#pet`, add `cursor: grab`
- `packages/overlay/src/main/window.ts` — add `ipcMain.on("drag-delta")` handler, revert `focusable` to `false`

---

## Bug H: `hasError` flag persists across sessions, skips one done celebration

**File:** `packages/plugin/src/state-deriver.ts` — `hasError` flag (line 41) and `session.idle` handler (lines 115-129)

**Problem:** When a `session.error` event fires, the `hasError` flag is set to `true`. It is only reset to `false` when the subsequent `session.idle` handler's error-guard branch runs. If a new, healthy session begins and ends before that guard fires, the first `session.idle` of the new session skips the done celebration because `hasError` is still `true` from the previous error.

**Trace:**

1. `session.error` fires → `hasError = true` → `TaskErrored` creates error mood (5s temporary)
2. Error expires after 5s → mood reverts to idle via `deriveMood(state)`
3. `hasError` is still `true` — the error guard only clears it when `session.idle` fires next
4. User starts a new session → agent works → session ends → `session.idle` fires
5. Error guard: `this.hasError` is `true` → skips `SessionCompleted` entirely → `hasError = false`
6. Pet never shows "done" for this session — it goes straight from working/thinking to idle
7. Next `session.idle` (another session) works normally — `hasError` is now `false`

**Impact:** One "done" celebration is silently skipped after every session error. Since the error itself is the notable event (the pet showed `error` mood for 5s), the missing `done` is unlikely to be noticed by the user. The flag self-heals on the next `session.idle`.

**Fix:** Reset `hasError` alongside the temporary state expiry. When the error timer fires and the temporary state reverts, `hasError` should be cleared at the same time. This can be done in the `manageExpiryTimer()` callback or by hooking into the mood transition from `error` to any non-error mood in `handleEvent()`:

```
// In handleEvent(), after state transition:
if (this.hasError && newState.mood !== "error" && !newState.temporary) {
  this.hasError = false;
}
```

---

## Bug I: Missing `part` undefined guard in `message.part.updated` handler

**File:** `packages/plugin/src/state-deriver.ts` — `handleSseEvent()` `message.part.updated` case (lines 69-84)

**Problem:** The `PartUpdatedProps` interface types `part` as required:

```typescript
interface PartUpdatedProps {
  part: { id: string; type: string };
}
```

But this is a compile-time type assertion (`event.properties as PartUpdatedProps`) — it provides no runtime guarantee. If an SSE event arrives without a `part` property for any reason (malformed event, SDK version mismatch, edge case in OpenCode's event emission), `part` would be `undefined` at runtime, and the subsequent `STREAM_PART_TYPES.has(part.type)` access would throw a `TypeError: Cannot read properties of undefined`.

The old code had a defensive `if (part === undefined) return;` guard before accessing `part.type`. It was removed during the refactor that switched from `delta`-based tracking to `activeStreamParts`-based tracking.

**Trace:**

1. OpenCode emits `message.part.updated` with missing or malformed `part` property
2. Destructuring: `const { part } = event.properties as PartUpdatedProps` → `part` is `undefined`
3. `STREAM_PART_TYPES.has(part.type)` → `TypeError: Cannot read properties of undefined (reading 'type')`
4. The uncaught error propagates up from `handleSseEvent()` → the plugin's `event` hook rejects → OpenCode may log an error or show it to the user
5. No `StreamStarted` is sent for this part — if it was the first part of a stream, `activeStreams` stays at 0 and the pet never shows "thinking"

**Impact:** Low probability — `message.part.updated` events in OpenCode reliably include a `part` property. However, if triggered, it causes an unhandled exception that breaks the entire SSE event handler for that event, potentially missing mood transitions.

**Fix:** Add a runtime guard before accessing `part.type`:

```
const { part } = event.properties as PartUpdatedProps;
if (!part) return;
if (!STREAM_PART_TYPES.has(part.type)) return;
```

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
