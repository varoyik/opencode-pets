# plugin-publishing

## Purpose

Build pipeline for producing a single publishable npm package (`opencode-pets`). Uses `bun build` to inline `@opencode-pets/core` into the plugin's `dist/` directory, eliminating the need for a separate `@opencode-pets/core` npm package or a scoped npm org. The published package contains only compiled JavaScript — no TypeScript source, no postinstall scripts, no platform-specific binaries.

## Requirements

### Requirement: Plugin package.json configured for npm publishing

The plugin's `package.json` SHALL be configured with `main` pointing to `./dist/index.js`, `files` set to `["dist"]`, an `exports` field mapping `.` to `./dist/index.js` and `./tui` to `./dist/tui.js` (no `types` pointer for `./tui` — `src/` is excluded from the tarball), `@opencode-ai/plugin` in `peerDependencies` (not `dependencies`), `@opentui/*` packages in `devDependencies` (externalized in the TUI build, provided at runtime by OpenCode), and a `prepublishOnly` script that runs the build.

#### Scenario: package.json fields correct

- **WHEN** the plugin's `package.json` is inspected
- **THEN** `main` is `./dist/index.js`
- **AND** `files` is `["dist"]`
- **AND** `exports["."]` is `{"import": "./dist/index.js"}`
- **AND** `exports["./tui"]` is `{"import": "./dist/tui.js"}` (no `types` field — `src/` is excluded from the tarball and the TUI plugin is loaded at runtime, not consumed as a typed library)
- **AND** `peerDependencies` includes `@opencode-ai/plugin`
- **AND** `devDependencies` includes `@opentui/core`, `@opentui/keymap`, `@opentui/solid` (externalized in the TUI build, provided at runtime by OpenCode)
- **AND** `prepublishOnly` runs `bun run build`

### Requirement: Plugin build produces server and TUI outputs

The plugin SHALL be built using a combined build script that runs the server build and the TUI build. The server build uses `bun build` with `--target bun --format esm --external @opencode-ai/plugin` to inline `@opencode-pets/core` (resolved from the workspace) into the plugin's `dist/index.js` while keeping `@opencode-ai/plugin` as a runtime import. The TUI build uses `scripts/build-tui.ts` (which calls `Bun.build` with `@opentui/solid/bun-plugin`) to compile `src/tui/index.tsx` into `dist/tui.js`, with all `@opencode-ai/*` and `@opentui/*` packages externalized (provided at runtime by OpenCode).

#### Scenario: Server build inlines core

- **WHEN** `bun build src/index.ts --outdir dist --target bun --format esm --external @opencode-ai/plugin` is run
- **THEN** `dist/index.js` is produced
- **AND** the file contains core's code inlined (no `import ... from "@opencode-pets/core"`)
- **AND** the file contains `import ... from "@opencode-ai/plugin"` (external, not bundled)

#### Scenario: TUI build produces externalized output

- **WHEN** `bun run scripts/build-tui.ts` is run
- **THEN** `dist/tui.js` is produced
- **AND** the file contains `import ... from "@opentui/solid"` (external, not bundled)
- **AND** the file contains `import ... from "@opencode-ai/plugin"` (external, not bundled)

#### Scenario: Bundled outputs are importable

- **WHEN** the bundled `dist/index.js` is imported by Bun
- **THEN** it loads without module resolution errors
- **AND** the default export is a function (the plugin factory)
- **AND** when `dist/tui.js` is imported by Bun, it loads without module resolution errors

### Requirement: No postinstall script

The plugin's `package.json` SHALL NOT declare a `postinstall` script. The overlay binary is delivered via the auto-download mechanism at plugin init time, not via postinstall. This is because OpenCode auto-installs plugins with `ignoreScripts: true`, which prevents postinstall from running.

#### Scenario: No postinstall in published package

- **WHEN** the plugin's `package.json` is inspected
- **THEN** there is no `scripts.postinstall` field
- **AND** the overlay binary is not fetched during `npm install`

### Requirement: Published tarball contains only dist and package.json

The published npm tarball SHALL contain only `dist/` (compiled JavaScript), `package.json`, and `README.md`. No TypeScript source (`src/`), no scripts (`scripts/`), no overlay binaries, no `setup-dev.sh`.

#### Scenario: npm pack output correct

- **WHEN** `npm pack --dry-run` is run in `packages/plugin/`
- **THEN** the tarball contains `dist/index.js`, `dist/tui.js`, `dist/tui.js.map`, `dist/overlay-downloader.js`, `dist/state-deriver.js`, `dist/ipc-client.js`, `dist/overlay-manager.js`, `dist/config.js`, `dist/pet-scanner.js`, `package.json`, `README.md`
- **AND** the tarball does NOT contain `src/`, `scripts/`, or any `.ts`/`.tsx` files

### Requirement: prepublishOnly runs build

The `prepublishOnly` script SHALL run `bun run build` to ensure `dist/` is freshly built before publishing. This prevents publishing stale or missing build output.

#### Scenario: Build runs before publish

- **WHEN** `npm publish` is run
- **THEN** `prepublishOnly` executes `bun run build`
- **AND** `dist/` is regenerated from current source
- **AND** only the fresh `dist/` is included in the tarball

### Requirement: README documents two-config-file user setup

The published package's `README.md` SHALL document that users must register the plugin in BOTH `~/.config/opencode/opencode.json` (server plugin, `"plugin": ["opencode-pets"]`) AND `~/.config/opencode/tui.json` (TUI plugin, `"plugin": ["opencode-pets/tui"]`). This is required because OpenCode has two separate plugin loading pipelines — `opencode.json` loads server plugins (the `.` export) and `tui.json` loads TUI plugins (the `./tui` export). OpenCode does NOT auto-discover the `./tui` export from `opencode.json`. Without the `tui.json` entry, the `/pet` command's `DialogAlert` does not load — the LLM is still blocked (the `__PET_HANDLED__` throw aborts `prompt()`) but the user sees a raw error message instead of a clean dialog.

#### Scenario: README includes both config entries

- **WHEN** the published `README.md` is inspected
- **THEN** it contains instructions to add `"opencode-pets"` to the `"plugin"` array in `~/.config/opencode/opencode.json`
- **AND** it contains instructions to add `"opencode-pets/tui"` to the `"plugin"` array in `~/.config/opencode/tui.json`
- **AND** it explains that the `tui.json` entry is required for the `/pet` DialogAlert (without it, a raw error is shown instead of a clean dialog)

#### Scenario: Missing tui.json entry degrades UX but does not leak to LLM

- **WHEN** a user registers `opencode-pets` in `opencode.json` but NOT `opencode-pets/tui` in `tui.json`
- **AND** runs `/pet` in an OpenCode session
- **THEN** the LLM does not process `/pet` (the `__PET_HANDLED__` throw still blocks `prompt()`)
- **AND** a raw `__PET_HANDLED__` error is displayed instead of the `DialogAlert`
- **AND** the overlay still toggles/spawns (the server plugin's `command.execute.before` hook runs before the throw)

### Requirement: Overlay build produces standalone dist

The overlay's build script SHALL compile TypeScript and copy renderer assets to `dist/` without launching Electron. The script SHALL be `tsc --build && bun scripts/copy-assets.ts`. This produces the input for `electron-builder --dir`.

#### Scenario: Overlay build produces correct dist structure

- **WHEN** `bun run build` is run in `packages/overlay/`
- **THEN** `dist/main/index.js` exists (compiled main process)
- **AND** `dist/preload/bridge.cjs` exists (compiled preload, CommonJS)
- **AND** `dist/renderer/index.html` exists (copied from src)
- **AND** `dist/renderer/style.css` exists (copied from src)
- **AND** `dist/renderer/app.js` exists (compiled renderer)
- **AND** `dist/renderer/context-menu.html` exists (copied from src)
- **AND** `dist/renderer/context-menu.css` exists (copied from src)

### Requirement: electron-builder --dir produces platform bundle

The overlay SHALL be packaged using `electron-builder --dir` configured via `electron-builder.yml`. The output SHALL be a self-contained directory containing the Electron runtime + app code + assets. The config SHALL specify `dir` target (not installers) for all platforms.

#### Scenario: Linux build produces unpacked directory

- **WHEN** `electron-builder --dir --linux --x64` is run
- **THEN** `dist-build/linux-unpacked/` is produced
- **AND** it contains an executable `opencode-pets-overlay` (ELF binary)
- **AND** it contains `resources/` with app code and assets
- **AND** it contains the Electron runtime libraries

#### Scenario: macOS build produces .app bundle

- **WHEN** `electron-builder --dir --mac --arm64` is run
- **THEN** `dist-build/mac-arm64/opencode-pets-overlay.app/` is produced
- **AND** it contains `Contents/MacOS/opencode-pets-overlay` (Mach-O binary)
- **AND** it contains `Contents/Resources/` with app code and assets

#### Scenario: Windows build produces unpacked directory

- **WHEN** `electron-builder --dir --win --x64` is run
- **THEN** `dist-build/win-unpacked/` is produced
- **AND** it contains `opencode-pets-overlay.exe`
- **AND** it contains DLLs and `resources/` with app code and assets
