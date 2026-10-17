# Tasks

## 1. Dual-mode entrypoints

- [x] 1.1 Default-export `{ id, server, setup }` from `src/index.ts` (V1 + V2 server legs)
- [x] 1.2 Default-export `{ id, tui, setup }` from `src/tui/index.tsx` (V1 + V2 TUI legs)
- [x] 1.3 `package.json`: `exports` (`.`, `./tui`, `./rpc`), `engines.opencode` (`^1.18.29 || ^2.0.0`), optional `@opencode/plugin` peer

## 2. Shared runtime

- [x] 2.1 Extract generation-agnostic `PetController` (`src/runtime.ts`): config load/watch, pet scan, overlay install, spawn/toggle, `/pet` flow, dispose
- [x] 2.2 Introduce `PetNotifier` (dialog/toast) with non-rejecting implementations per generation
- [x] 2.3 Move dialog/toast copy and the `PetsRpc` definition into `src/rpc.ts`
- [x] 2.4 `overlay-downloader`: accept a notifier-supplied toast function instead of the V1 client

## 3. V1 leg (behavior-preserving)

- [x] 3.1 `src/v1.ts`: `server` plugin with `config` hook, `command.execute.before` sentinel, `tui.publish` dialogs, `showToast` toasts
- [x] 3.2 Keep `__PET_HANDLED__`, `__PET_COMMAND__`, and `pet.show_dialog_*` names unchanged
- [x] 3.3 Keep `tool.execute.before/after` and `event` hooks wiring

## 4. V2 leg

- [x] 4.1 `src/v2.ts`: `setup(ctx)` → controller init, `ctx.command.transform` (`/pet`), `ctx.tool.hook`, `ctx.event.subscribe`
- [x] 4.2 `ctx.rpc.register(PetsRpc, {})` with silent degradation when unavailable
- [x] 4.3 TUI leg: subscribe `PetsRpc` events, filter by location directory, 3 s dialog auto-close
- [x] 4.4 Cleanup: abort the SSE subscription and dispose the controller
- [x] 4.5 Stand down both V2 legs on pre-RPC transition hosts (1.18.29–1.19.3) so the legacy hooks remain the only leg

## 5. Event generations

- [x] 5.1 Accept payloads under `properties` (classic) or `data` (`session.next.*` / V2)
- [x] 5.2 Normalize `session.next.*` → `session.*` and `permission.v2.*` → `permission.*`
- [x] 5.3 Latch V2 generation only on V2-only event families; clear classic stream keys and emit one `StreamEnded`
- [x] 5.4 Dispatch the V2 event set (step/text/reasoning/execution/status/idle/permission)
- [x] 5.5 Route V2 tool bubbles through the tool hooks

## 6. Build and packaging

- [x] 6.1 Build `dist/{index,tui,rpc}.js`; TUI externals include `@opencode/plugin*` and `@opencode/client*`
- [x] 6.2 Verify dist artifacts contain no `@opencode/plugin` / `@opencode-ai/plugin` runtime imports
- [x] 6.3 `bun run build` and `bun run typecheck` (both tsconfigs) pass

## 7. Validation

- [x] 7.1 Local directory target loads on OpenCode 2.0.30 ("loading plugin" + setup side effects in server logs)
- [x] 7.2 Live TUI: `/pet` shows the launch dialog with 3 s auto-close, spawns the overlay, and toggles visibility
- [x] 7.3 `/pet` does not reach the model on V2
- [x] 7.4 V1 regression: headless load verified on OpenCode 1.18.29 and 1.19.3 (legacy hooks run; V2 legs stand down on pre-RPC hosts)

## 8. Documentation

- [x] 8.1 README: V2 installation path and V1 minimum version note
- [x] 8.2 AGENTS.md: architecture and key-file updates
