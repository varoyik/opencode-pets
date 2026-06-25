# overlay-distribution

## Purpose

Plugin auto-downloads the platform-specific overlay binary from GitHub Releases on first load. The overlay is a self-contained Electron app bundle (~50-80MB compressed) produced by `electron-builder --dir`. The download is one-time, cached via a `VERSION` file, and only re-downloads when the plugin version changes. This eliminates the need for postinstall scripts (which OpenCode's auto-install ignores via `ignoreScripts: true`), platform-specific npm packages, or a CLI installer.

## Requirements

### Requirement: Platform detection

The plugin SHALL detect the user's platform and architecture using `process.platform` and `process.arch` and map them to a target string in the format `{platform}-{arch}` (e.g., `linux-x64`, `darwin-arm64`, `win32-x64`).

#### Scenario: Linux x64 detected

- **WHEN** the plugin runs on Linux x64
- **THEN** the target string is `linux-x64`

#### Scenario: macOS arm64 detected

- **WHEN** the plugin runs on macOS with Apple Silicon
- **THEN** the target string is `darwin-arm64`

#### Scenario: Windows x64 detected

- **WHEN** the plugin runs on Windows x64
- **THEN** the target string is `win32-x64`

### Requirement: Version cache validation

The plugin SHALL check for a `VERSION` file at `~/.opencode-pets/overlay/VERSION` on every load. If the file exists and its content matches the plugin's expected overlay version, the download SHALL be skipped entirely. If the file does not exist or its content does not match, the download SHALL proceed.

#### Scenario: Version matches — skip download

- **WHEN** the plugin loads and `~/.opencode-pets/overlay/VERSION` contains `1.0.0`
- **AND** the plugin's expected overlay version is `1.0.0`
- **THEN** no download occurs
- **AND** the plugin proceeds to spawn the overlay

#### Scenario: Version mismatch — re-download

- **WHEN** the plugin loads and `~/.opencode-pets/overlay/VERSION` contains `0.9.0`
- **AND** the plugin's expected overlay version is `1.0.0`
- **THEN** the download proceeds
- **AND** the old overlay files are overwritten

#### Scenario: No VERSION file — first download

- **WHEN** the plugin loads and `~/.opencode-pets/overlay/VERSION` does not exist
- **THEN** the download proceeds
- **AND** the `~/.opencode-pets/overlay/` directory is created if it doesn't exist

### Requirement: Download URL construction

The plugin SHALL construct the download URL as `https://github.com/varoyik/opencode-pets/releases/download/v{version}/overlay-{target}.{ext}` where `{ext}` is `tar.gz` for macOS and Linux, and `zip` for Windows.

#### Scenario: Linux URL constructed

- **WHEN** the target is `linux-x64` and the version is `1.0.0`
- **THEN** the URL is `https://github.com/varoyik/opencode-pets/releases/download/v1.0.0/overlay-linux-x64.tar.gz`

#### Scenario: Windows URL constructed

- **WHEN** the target is `win32-x64` and the version is `1.0.0`
- **THEN** the URL is `https://github.com/varoyik/opencode-pets/releases/download/v1.0.0/overlay-win32-x64.zip`

### Requirement: Download via fetch

The plugin SHALL download the archive using Bun's native `fetch()` API. The response SHALL be streamed to a temporary file in `os.tmpdir()`. If the HTTP response status is not 200, the download SHALL fail with an error toast.

#### Scenario: Successful download

- **WHEN** the plugin fetches the archive URL
- **AND** the response status is 200
- **THEN** the response body is written to a temp file
- **AND** extraction proceeds

#### Scenario: Download failure — HTTP error

- **WHEN** the plugin fetches the archive URL
- **AND** the response status is not 200 (e.g., 404 for missing release)
- **THEN** the download fails
- **AND** an error toast is shown
- **AND** the plugin returns `false` (graceful degradation)

#### Scenario: Download failure — network error

- **WHEN** the plugin fetches the archive URL
- **AND** `fetch()` throws a network error
- **THEN** the download fails
- **AND** an error toast is shown
- **AND** the plugin returns `false` (graceful degradation)

### Requirement: Archive extraction

The plugin SHALL extract the downloaded archive to `~/.opencode-pets/overlay/`. On macOS and Linux, extraction SHALL use `tar -xzf {tmpFile} -C {overlayPath}` via `Bun.spawn()`. On Windows, extraction SHALL use PowerShell `Expand-Archive -Path {tmpFile} -DestinationPath {overlayPath} -Force` via `Bun.spawn()`.

#### Scenario: Linux/macOS extraction

- **WHEN** the archive is `overlay-linux-x64.tar.gz`
- **THEN** `tar -xzf {tmpFile} -C ~/.opencode-pets/overlay/` is executed
- **AND** the extracted files populate `~/.opencode-pets/overlay/`

#### Scenario: Windows extraction

- **WHEN** the archive is `overlay-win32-x64.zip`
- **THEN** `powershell -Command "Expand-Archive -Path {tmpFile} -DestinationPath ~/.opencode-pets/overlay/ -Force"` is executed
- **AND** the extracted files populate `~/.opencode-pets/overlay/`

### Requirement: VERSION file written after extraction

After successful extraction, the plugin SHALL write the overlay version string to `~/.opencode-pets/overlay/VERSION`. This file is the cache key for subsequent loads.

#### Scenario: VERSION file created

- **WHEN** extraction completes successfully
- **THEN** `~/.opencode-pets/overlay/VERSION` is written with the version string (e.g., `1.0.0`)

### Requirement: Toast notifications

The plugin SHALL show toast notifications via `client.tui.showToast()` at each stage of the download flow.

#### Scenario: Download starts

- **WHEN** the download begins
- **THEN** a toast is shown: title `opencode-pets`, message `Setting up overlay (one-time download ~60MB)...`

#### Scenario: Download succeeds

- **WHEN** extraction and VERSION file write complete
- **THEN** a toast is shown: title `opencode-pets`, message `Overlay ready! Run /pet to summon your pet.`

#### Scenario: Download fails

- **WHEN** any step fails (network, HTTP error, extraction, disk)
- **THEN** a toast is shown: title `opencode-pets`, message `Overlay setup failed. Pet disabled. Will retry next session.`

### Requirement: Graceful degradation on failure

If the download or extraction fails for any reason, the plugin SHALL NOT throw or crash OpenCode. It SHALL log the error via the `LogFn`, show the failure toast, and return `false` from `ensureOverlayInstalled()`. The plugin SHALL return hooks without overlay management — the event hook and other hooks still function, but no overlay process is spawned. The next OpenCode session retries automatically.

#### Scenario: Plugin loads without pet after download failure

- **WHEN** `ensureOverlayInstalled()` returns `false`
- **THEN** the plugin returns hooks without spawning the overlay
- **AND** OpenCode continues running normally
- **AND** no error is thrown

#### Scenario: Retry on next session

- **WHEN** the user restarts OpenCode after a download failure
- **THEN** the plugin attempts the download again
- **AND** if successful, the overlay is installed and `/pet` works

### Requirement: Temp file cleanup

The plugin SHALL delete the temporary archive file from `os.tmpdir()` after extraction, regardless of whether extraction succeeded or failed.

#### Scenario: Temp file cleaned after success

- **WHEN** extraction completes successfully
- **THEN** the temp file in `os.tmpdir()` is deleted

#### Scenario: Temp file cleaned after failure

- **WHEN** extraction fails
- **THEN** the temp file in `os.tmpdir()` is still deleted

### Requirement: Dev mode bypass

When the plugin is running in development mode (loaded from the monorepo via `file://`), the auto-download SHALL be bypassed if the overlay directory was set up by `setup-dev.sh`. The presence of a `node_modules/.bin/electron` symlink in `~/.opencode-pets/overlay/` indicates dev mode and SHALL skip the download.

#### Scenario: Dev mode skips download

- **WHEN** the plugin loads in development
- **AND** `~/.opencode-pets/overlay/node_modules/.bin/electron` exists (symlink from `setup-dev.sh`)
- **THEN** the download is skipped
- **AND** the plugin spawns from the dev symlink path
