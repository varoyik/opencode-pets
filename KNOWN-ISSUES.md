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

## Bug C: `@opencode-pets/core` module not found in deployed overlay

**File:** `packages/plugin/scripts/setup-dev.sh` (incomplete deployment) + `packages/overlay/dist/main/ipc-server.js` (imports `@opencode-pets/core`)

**Problem:** When the plugin spawns the overlay via `npx electron .` from
`~/.opencode-pets/overlay/`, Electron's main process loads
`dist/main/index.js` which imports `@opencode-pets/core`. Node.js module
resolution fails because:

1. `setup-dev.sh` copies `dist/`, `assets/`, and `package.json` but **does not**
   set up `node_modules` at the target path.
2. The copied `package.json` has `"@opencode-pets/core": "workspace:*"` — this
   protocol only works inside the Bun monorepo and is meaningless at the
   deployed path.
3. No `node_modules/@opencode-pets/core` directory exists at the deployed path,
   and parent-directory traversal never reaches the monorepo's `node_modules`.

**Trace:**

1. Plugin calls `Bun.spawn(["npx", "electron", "."], { cwd: "~/.opencode-pets/overlay/" })`
2. Electron boots, loads `package.json` → `main: "./dist/main/index.js"`
3. `index.js` imports `@opencode-pets/core`
4. Node.js module resolution looks in `~/.opencode-pets/overlay/node_modules/` → not found
5. Parent dirs (`~/.opencode-pets/`, `~/`, `/home/`, ...) → none have it
6. `ERR_MODULE_NOT_FOUND: Cannot find package '@opencode-pets/core'`
7. Overlay crashes before creating the Unix socket
8. Plugin health check (Bug E) times out → kills process
9. IPC client gets connection errors (Bug F)

**Fix:** Two approaches:

- **Quick:** `setup-dev.sh` must run `bun install` at the target path (with
  workspace protocol replaced by a `file:` or version dependency). This copies
  `@opencode-pets/core` and its transitive dep `zod` into the deployed
  `node_modules`.
- **Proper:** Bundle the overlay into a self-contained executable (e.g., via
  `electron-builder`). A bundled app has all modules embedded — no external
  `node_modules` dependency. This is the production path and also eliminates Bug D.

---

## Bug D: Spritesheet path resolves incorrectly in deployed overlay ✅ FIXED

**File:** `packages/overlay/src/main/window.ts` — resolved in Phase 1.7.

**Fix applied:** Spritesheets moved from monorepo root `pets/` to `packages/overlay/assets/pets/`.
Path in `window.ts` changed from `../../pets/code-companion/spritesheet.webp` to
`assets/pets/claude-crab/spritesheet.webp` — a relative path from `app.getAppPath()` that
works identically in both monorepo dev and deployed `~/.opencode-pets/overlay/`.

---

## Bug E: Health check timeout kills overlay prematurely

**File:** `packages/overlay/src/main/overlay-manager.ts` — `healthCheck()` (5s timeout) + `spawnOverlay()` (`npx electron` overhead)

**Problem:** `startOverlay()` spawns the overlay process and polls for the Unix
socket file with a **5-second timeout**. This is too short because:

1. `npx electron .` has significant startup overhead (npx module resolution +
   Electron binary boot + renderer process + window creation + socket server binding).
2. Combined with Bug C (overlay crashes before creating the socket because
   `@opencode-pets/core` can't be found), the socket **never** gets created.
3. On timeout, `killOverlay()` kills the process, destroying the rendered
   window (pet appears briefly, then disappears).
4. The `ipc-client` then floods with connection errors because the socket
   server never existed.

**Trace:**

1. Plugin spawns overlay → health check starts polling
2. `npx electron` boots → if slow, 5s passes
3. `healthCheck()` returns `false` → `killOverlay(proc)` called
4. Pet window destroyed → `overlayStarted = false`
5. `/pet` command → "Pet overlay is not running"
6. State deriver sends events → `ipc-client` tries connecting → errors

**Fix:** Two changes:

1. Increase timeout to at least 15s (Electron cold-start can take 5–10s).
2. Don't kill the overlay on timeout — the `IpcClient` has its own
   exponential-backoff reconnection logic. Let it handle late socket binding.
   Only kill if the process itself exits/crashes.

---

## Bug F: Bun.connect() requires `data`/`drain` callback for unix sockets

**File:** `packages/plugin/src/ipc-client.ts` — `connect()` function (line 102)

**Problem:** `Bun.connect()` for Unix domain sockets requires at least one of
`data` or `drain` callbacks in the socket handler object. The `IpcClient` is
write-only (it only sends messages; never reads), so neither callback is defined.
Bun throws: `Expected at least "data" or "drain" callback`.

This was discovered when running `test-plugin.ts` (task 8.1) against a running
overlay started via `bun run dev` from the monorepo. Without the fix,
`test-plugin.ts` crashes immediately.

**Fix:** Add a no-op `data: () => {}` callback to the socket handler object in
`Bun.connect({ unix: ..., socket: { data: () => {}, ... } })`.

---

## Architectural Note: `~/.opencode-pets/overlay/` deployment model

All Bugs C–E share the same root cause: the current "file-copy" deployment
model (`setup-dev.sh` copies loose files to `~/.opencode-pets/overlay/`) is
fragile. It doesn't handle:

- **Dependency resolution** — compiled JS expects `@opencode-pets/core` in
  `node_modules`, but `node_modules` is never deployed.
- **Asset bundling** — ~~the spritesheet lives at the monorepo root and is
  referenced via a fragile relative path (`../../pets/...`) that only works
  inside the monorepo directory structure.~~ ✅ Fixed in Phase 1.7: pets now live in `packages/overlay/assets/pets/`.
- **Process spawning** — relying on `npx electron .` at the deployed path adds
  startup latency and intermediate failure modes.

**Recommended fix (post-MVP):** Bundle the overlay into a self-contained
Electron executable using `electron-builder`. The plugin would then spawn the
executable directly (no `npx`) and all modules, assets, and the Electron
runtime are bundled together. This eliminates Bugs C, D, and E in one shot.
