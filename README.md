# opencode-pets

A desktop companion for OpenCode that reacts to your coding sessions in real time. Drag it around, throw it across the screen, switch between pets (PetDex compatible), and watch it respond to every tool call, reasoning step, and permission prompt with contextual speech bubbles.

<p align="center">
  <video
    src="https://github.com/user-attachments/assets/5d741e19-14b0-4607-a4b0-281ecad4fb64"
    autoplay loop muted playsinline
    width="800"
    controls
  >
    <a href="./assets/demo.mp4">Watch the demo (MP4)</a>
  </video>
</p>

## Quick Start

Add `opencode-pets` to your OpenCode server config (`~/.config/opencode/opencode.json` or a project-local `.opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-pets"]
}
```

Add it to your TUI config (`~/.config/opencode/tui.json` or `.opencode/tui.json`):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-pets"]
}
```

Restart OpenCode. Run `/pet`. Done.

> [!IMPORTANT]
> The first time you run `/pet`, the plugin downloads the overlay binary (around 100 MB) from GitHub Releases to `~/.opencode-pets/overlay/`. This is a one-time download. Subsequent starts are instant.

> [!NOTE]
> On Hyprland, the overlay runs under XWayland. Add the window rules in [docs/hyprland.md](docs/hyprland.md) for proper transparency, pinning, and no-focus behavior.

## Config

The config file lives at `~/.config/opencode/opencode-pets.json` (or `%APPDATA%/opencode/opencode-pets.json` on Windows). The `OPENCODE_CONFIG_DIR` and `XDG_CONFIG_HOME` environment variables override the directory.

Default config:

```json
{
  "defaultPet": "gutsy",
  "idleTimeoutMs": 30000,
  "bubbleDurationMs": 5000
}
```

Options:

- `defaultPet` - Pet ID to load on startup (default: `gutsy`). Must match a pet from the bundled set, `~/.opencode/pets/`, or `~/.codex/pets/`.
- `idleTimeoutMs` - Milliseconds of inactivity before the pet returns to idle mood (default: `30000`).
- `bubbleDurationMs` - Milliseconds before done, error, and idle speech bubbles auto-dismiss (default: `5000`). Active-mood bubbles (thinking, working, waiting) persist until the mood changes.
- `position` - Window position `{ x, y }` saved on drag end. You don't need to set this manually.

The config hot-reloads on save, writes atomically, and falls back to defaults if the file is corrupt.

## Features

- Six moods derived from session context: idle, thinking, working, waiting, done, error. Mood comes from active tool counts, streaming state, and permission prompts, not a static priority list.
- Contextual speech bubbles with mood-dependent icons. Tool names map to friendly messages, reasoning text is truncated, permission titles show when waiting.
- Drag the pet anywhere on screen. Velocity smoothing triggers directional run animations while you drag.
- Throw it. Release with enough speed and the pet coasts with friction, bounces off screen edges, and settles to a stop.
- Right-click the pet for a context menu: switch pet, toggle the speech bubble, quit the overlay.
- Position persists across restarts, saved to the config file on drag end.
- Three pets bundled: Claude Crab, Gutsy (default), NezukoCoder.
- PetDex compatible. Any of the 3,000+ community pets from [petdex.dev](https://petdex.dev/) work automatically, no extra setup.
- Cross-platform: macOS, Linux, Windows.

## Pets

Three pets ship with the overlay:

- **Claude Crab** - a tiny orange blocky Claude Code mascot with black square eyes and four little legs.
- **Gutsy** (default) - a tiny fierce dark swordsman with spiky black hair, a cloak, dark armor, one intense eye, and an oversized slab sword.
- **NezukoCoder** - a chibi Nezuko-inspired coding companion typing on a laptop with a simple OpenAI emblem.

### Adding more pets

Browse [petdex.dev](https://petdex.dev/) and install any pet with one command:

```bash
npx petdex install <slug>
```

The pet lands in `~/.codex/pets/<slug>/`. opencode-pets scans that directory automatically, so the pet shows up in the right-click switch menu with no extra setup.

You can also drop a pet folder into `~/.opencode/pets/` manually. Each pet needs a `pet.json` manifest and a spritesheet (1536×1872, 8×9 grid, 192×208 px cells, WebP or PNG).

Switch pets at runtime through the right-click context menu, or set the default in config:

```json
{ "defaultPet": "claude-crab" }
```

## How it works

opencode-pets is an OpenCode plugin, not a standalone app. The plugin hooks into OpenCode's SSE event stream and tool lifecycle, derives pet mood from session context, and spawns a lightweight Electron overlay. The plugin and overlay talk over a Unix domain socket (macOS/Linux) or named pipe (Windows).

```
OpenCode
  │
  ├── Pet plugin (server)
  │     hooks SSE events + tool lifecycle
  │     derives mood from session context
  │     spawns and manages the overlay
  │
  │   ─── Unix socket / named pipe ───►  Electron overlay
  │                                        transparent frameless window
  │                                        CSS spritesheet animation
  │                                        drag, throw, speech bubble
  │
  └── Pet TUI plugin
        keymap commands + DialogAlert
        for /pet feedback
```

The overlay is a transparent, frameless, always-on-top window with `focusable: false`, so it never steals keyboard focus. It renders a CSS spritesheet and swaps animation classes on mood changes. On Linux Wayland, it runs under XWayland automatically because native Wayland can't self-position or stay on top.

## License

MIT
