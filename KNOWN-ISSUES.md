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
