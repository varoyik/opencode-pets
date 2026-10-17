# add-opencode-v2-support

## Why

OpenCode 2.x replaced the plugin API. V1 plugin implementations do not run in V2: the V2 loader rejects the current default export with `Plugin must export a default definition with an id and an effect or setup function.`, and the V2 TUI rejects the V1 TUI module with `Invalid V2 TUI plugin module: opencode-pets`. Users who upgrade to OpenCode 2.x lose the pet entirely — the plugin never loads, `/pet` does nothing, and startup surfaces raw errors.

## What Changes

- **Dual-mode plugin entry.** `packages/plugin/src/index.ts` default-exports `{ id: "opencode-pets", server, setup }`: the V1 loader reads `server`, the V2 loader reads `id` + `setup`, and each ignores the other's keys. The TUI entry (`packages/plugin/src/tui/index.tsx`) default-exports `{ id, tui, setup }` the same way. `engines.opencode` becomes `^1.18.29 || ^2.0.0` (V1 below 1.18.29 has no object-entry support).
- **Shared runtime.** A generation-agnostic `PetController` (`src/runtime.ts`) owns config, pet scanning, overlay install/spawn, IPC, state derivation, and the `/pet` flow. `src/v1.ts` and `src/v2.ts` provide only generation-specific glue and a `PetNotifier` implementation for dialogs/toasts.
- **V2 server leg.** `setup(ctx)` registers `/pet` through `ctx.command.transform` (side-effect only — no sentinel, no model round-trip), tool hooks through `ctx.tool.hook`, the SSE stream through `ctx.event.subscribe`, and dialog/toast delivery through `ctx.rpc.register(PetsRpc, {})`. RPC registration failure degrades to silent no-op notifications.
- **V2 TUI leg.** The TUI plugin subscribes to `PetsRpc` `dialog`/`toast` events via `context.client.rpc(PetsRpc)`, location-filtered, and renders a 3-second auto-closing alert / toast. `@opentui/solid` remains the only runtime import.
- **Three-generation event handling.** The state deriver accepts V1 classic events (payload under `properties`) and V2 events (payload under `data`), normalizes `session.next.*` / `permission.v2.*` names, and latches generation-2 mode only on V2-only event families so OpenCode 1.18's dual emission is never double-counted.
- **Notification contract.** Dialog and toast copy plus the `PetsRpc` definition live in `src/rpc.ts`; V1 delivers via `client.tui.publish` / `client.tui.showToast`, V2 via RPC events.
- **Build outputs.** `dist/index.js`, `dist/tui.js`, and `dist/rpc.js`. No artifact contains a runtime import of `@opencode/plugin` or `@opencode-ai/plugin`.

## Impact

- Affected specs: `plugin-lifecycle`, `pet-command`, `event-state-derivation`, `plugin-publishing`.
- Affected code: `packages/plugin/src/{index,v1,v2,rpc,runtime,state-deriver,overlay-downloader}.ts`, `packages/plugin/src/tui/index.tsx`, `packages/plugin/scripts/build-tui.ts`, `packages/plugin/package.json`.
- Released artifacts stay behavior-compatible for OpenCode 1.18.29+ users; V1 users below 1.18.29 are intentionally dropped and documented in the README.
- No version bump in this change — release handling is left to the maintainer.
