# plugin-publishing (delta)

## MODIFIED Requirements

### Requirement: Plugin package.json configured for npm publishing

The plugin's `package.json` SHALL be configured with `main` pointing to `./dist/index.js`, `files` set to `["dist"]`, an `exports` field mapping `.` to `./dist/index.js`, `./tui` to `./dist/tui.js`, and `./rpc` to `./dist/rpc.js`, `@opencode-ai/plugin` (`^1.18.29`) and `@opencode/plugin` (`^2.0.0`, optional) in `peerDependencies`, an `engines.opencode` range of `^1.18.29 || ^2.0.0`, `@opentui/*` and `@opencode/theme` packages in `devDependencies` (externalized in the TUI build, provided at runtime by OpenCode), and a `prepublishOnly` script that runs the build.

#### Scenario: package.json fields correct

- **WHEN** the plugin's `package.json` is inspected
- **THEN** `main` is `./dist/index.js`
- **AND** `files` is `["dist"]`
- **AND** `exports` maps `.` → `./dist/index.js`, `./tui` → `./dist/tui.js`, and `./rpc` → `./dist/rpc.js`
- **AND** `engines.opencode` is `^1.18.29 || ^2.0.0`
- **AND** `peerDependencies` includes `@opencode-ai/plugin` and an optional `@opencode/plugin`
- **AND** `devDependencies` includes `@opentui/core`, `@opentui/keymap`, `@opentui/solid`, and `@opencode/theme`
- **AND** `prepublishOnly` runs `bun run build`

### Requirement: Plugin build produces server and TUI outputs

The plugin SHALL be built using a combined build script that runs the server/RPC build and the TUI build. The server build uses `bun build src/index.ts src/rpc.ts --outdir dist --target bun --format esm --external @opencode-ai/plugin --external @opencode/plugin --external '@opencode/plugin/*'` to inline `@opencode-pets/core` into `dist/index.js` and `dist/rpc.js`. The TUI build uses `scripts/build-tui.ts` (which calls `Bun.build` with `@opentui/solid/bun-plugin`) to compile `src/tui/index.tsx` into `dist/tui.js`, externalizing `@opencode/*`, `@opencode-ai/*`, `@opentui/*`, and `solid-js`. No artifact SHALL contain a runtime import of `@opencode/plugin` or `@opencode-ai/plugin` — those packages are loaders/hosts, not runtime dependencies.

#### Scenario: Server build inlines core

- **WHEN** `bun build src/index.ts src/rpc.ts --outdir dist --target bun --format esm --external @opencode-ai/plugin --external @opencode/plugin --external '@opencode/plugin/*'` is run
- **THEN** `dist/index.js` and `dist/rpc.js` are produced
- **AND** the files contain core's code inlined (no `import ... from "@opencode-pets/core"`)
- **AND** the files contain no runtime `import ... from "@opencode-ai/plugin"` or `"@opencode/plugin"` statements

#### Scenario: TUI build produces externalized output

- **WHEN** `bun run scripts/build-tui.ts` is run
- **THEN** `dist/tui.js` is produced
- **AND** the file's only runtime imports are externalized packages provided by the OpenCode TUI host (`@opentui/solid` and friends)
- **AND** no `@opencode/plugin` or `@opencode-ai/plugin` runtime import remains

#### Scenario: Bundled outputs are importable

- **WHEN** the bundled `dist/index.js` is imported by Bun
- **THEN** it loads without module resolution errors
- **AND** the default export is an object with `id`, `server`, and `setup`
- **AND** when `dist/tui.js` is imported by Bun, it loads without module resolution errors
- **AND** its default export is an object with `id`, `tui`, and `setup`

### Requirement: Published tarball contains only dist and package.json

The published npm tarball SHALL contain only `dist/` (compiled JavaScript), `package.json`, and `README.md`. No TypeScript source (`src/`), no scripts (`scripts/`), no overlay binaries, no `setup-dev.sh`.

#### Scenario: npm pack output correct

- **WHEN** `npm pack --dry-run` is run in `packages/plugin/`
- **THEN** the tarball contains `dist/index.js`, `dist/tui.js`, `dist/rpc.js`, `package.json`, and `README.md`
- **AND** the tarball does NOT contain `src/`, `scripts/`, or any `.ts`/`.tsx` files

### Requirement: README documents two-config-file user setup

The published package's `README.md` SHALL document the installation for both OpenCode generations:

- **OpenCode 2.x**: add `"opencode-pets"` to the `"plugins"` array in `~/.config/opencode/opencode.json` (or run `opencode plugin add opencode-pets`). The server, TUI, and RPC entrypoints ship in one package and load automatically — no separate TUI config is needed.
- **OpenCode 1.x (1.18.29 or newer)**: add `"opencode-pets"` to the `"plugin"` array in `~/.config/opencode/opencode.json` (server plugin) AND to the `"plugin"` array in `~/.config/opencode/tui.json` (TUI plugin). Without the `tui.json` entry, the `/pet` dialog does not load and the raw sentinel error is shown.

The README SHALL state the minimum V1 version (1.18.29) explicitly.

#### Scenario: README includes V2 instructions

- **WHEN** the published `README.md` is inspected
- **THEN** it contains instructions to add `"opencode-pets"` to the `"plugins"` array in `~/.config/opencode/opencode.json`
- **AND** it notes that no separate TUI config entry is needed on 2.x

#### Scenario: README includes V1 instructions and minimum version

- **WHEN** the published `README.md` is inspected
- **THEN** it contains instructions to add `"opencode-pets"` to the `"plugin"` array in both `opencode.json` and `tui.json`
- **AND** it states that OpenCode 1.18.29 or newer is required on the V1 line
