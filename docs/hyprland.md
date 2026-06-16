# Hyprland Setup for OpenCode Pets

OpenCode Pets runs as an Electron overlay. Electron's native Wayland backend does not allow applications to position themselves, stay always-on-top, or span workspaces, so the overlay is automatically forced to run under XWayland on Linux Wayland sessions.

The plugin injects `--ozone-platform=x11` when spawning the overlay. The overlay sets `app.setName("opencode-pets")`, but Electron derives the actual WM_CLASS from the `package.json` name, resulting in `opencode-pets-overlay`. All examples below use this class — match your rules against it.

---

## Which config format do you have?

Hyprland 0.55+ selects its config parser **purely by file extension**:

- **`.lua`** → Lua parser (understands `hl.window_rule({...})`)
- **`.conf`** → legacy parser (understands `windowrule`, NOT `windowrulev2`)

**You cannot mix syntaxes.** Pick the path that matches your config file:

- [I have `hyprland.lua` — use Lua syntax](#window-rules-lua-syntax-hyprlandluaconfig)
- [I have `hyprland.conf` — use legacy syntax](#window-rules-legacy-syntax-hyprlandconf)
- [I want to migrate my `.conf` to `.lua`](#migrating-from-confto-lua-recommended)

> **Important:** On Hyprland 0.55+, `windowrulev2` is **hard-deprecated**. The legacy parser returns an immediate error for it. Use `windowrule` instead (see below).

---

## Window rules (Lua syntax — `hyprland.lua`)

If your config file is named `hyprland.lua`, add this block:

```lua
hl.window_rule({
    name = "opencode-pets-overlay",
    match = { class = "^(opencode-pets-overlay)$" },

    -- Applied once at window creation
    float = true,
    pin = true,
    no_initial_focus = true,
    no_anim = true,

    -- Reevaluated on property changes
    border_size = 0,
    rounding = 0,
    decorate = false,
    no_blur = true,
    no_shadow = true,
    no_focus = true,
    no_follow_mouse = true,
    opacity = "0.99 override 0.99 override 0.99 override",
})
```

---

## Window rules (legacy syntax — `hyprland.conf`)

If your config file is named `hyprland.conf`, use `windowrule`. **Do not use `windowrulev2`** — that keyword is dead on 0.55+.

The 0.54+ `windowrule` syntax requires:

- **Explicit values** for every field (`float on`, not bare `float`)
- **`match:` prefix** for match properties (`match:class`, not `class:`)
- **Space separator** between field name and value (not `=`)

```ini
windowrule = float on, match:class opencode-pets-overlay
windowrule = pin on, match:class opencode-pets-overlay
windowrule = no_initial_focus on, match:class opencode-pets-overlay
windowrule = no_anim on, match:class opencode-pets-overlay
windowrule = no_blur on, match:class opencode-pets-overlay
windowrule = no_shadow on, match:class opencode-pets-overlay
windowrule = border_size 0, match:class opencode-pets-overlay
windowrule = rounding 0, match:class opencode-pets-overlay
windowrule = decorate off, match:class opencode-pets-overlay
windowrule = opacity 0.99 override 0.99 override 0.99 override, match:class opencode-pets-overlay
windowrule = stay_focused on, match:class opencode-pets-overlay
windowrule = no_follow_mouse on, match:class opencode-pets-overlay
```

Or you can use the block-style syntax instead:

```ini
windowrule {
    name = opencode-pets-overlay
    match:class = opencode-pets-overlay
    float = on
    pin = on
    no_initial_focus = on
    no_anim = on
    no_blur = on
    no_shadow = on
    border_size = 0
    rounding = 0
    decorate = off
    opacity = 0.99 override 0.99 override 0.99 override
    stay_focused = on
    no_follow_mouse = on
}
```

---

## Migrating from `.conf` to `.lua` (Recommended)

The Hyprland team has stated the legacy parser will be dropped in 1–2 releases after 0.55. Convert now to avoid breakage later.

1. **Install the migration tool:**

   ```bash
   pip install hyprconf2lua
   ```

2. **Convert your config:**

   ```bash
   hyprconf2lua ~/.config/hypr/hyprland.conf -o ~/.config/hypr/hyprland.lua
   ```

3. **Add the pet rules** in Lua syntax (see the Lua section above).

4. **Test it:**

   ```bash
   hyprctl reload
   hyprctl configerrors
   ```

   If everything works, keep `hyprland.conf` as a backup but the `.lua` file takes priority.

---

## Why `opacity 0.99 override`?

Electron often reports the overlay window as fully opaque (alpha = 1) even when its content is transparent. Hyprland therefore skips rendering the desktop behind it. Forcing opacity to `0.99` makes Hyprland treat the window as semi-transparent, which restores proper transparency rendering.

---

## Finding the correct class

If the rules do not apply, find the actual class with:

```bash
hyprctl clients | grep -i "class.*opencode\|title.*pet"
```

Then update the `match:class` regex accordingly.

---

## Optional: fixed position

Instead of dragging, you can pin the pet to a corner at startup.

**Lua syntax (`hyprland.lua`):**

```lua
hl.window_rule({
    name = "opencode-pets-position",
    match = { class = "^(opencode-pets-overlay)$" },
    move = { "(monitor_w - 220)", "(monitor_h - 340)" },
    size = { "192", "310" },
})
```

**Legacy syntax (`hyprland.conf`):**

```ini
windowrule = move 100%-220 100%-340, match:class opencode-pets-overlay
windowrule = size 192 310, match:class opencode-pets-overlay
```

---

## Generic XWayland drag fix

If drag repositioning does not work, Hyprland's generic XWayland drag rule may help.

**Lua syntax (`hyprland.lua`):**

```lua
hl.window_rule({
    name = "fix-xwayland-drags",
    match = {
        class = "^$",
        title = "^$",
        xwayland = true,
        float = true,
        fullscreen = false,
        pin = false,
    },
    no_focus = true,
})
```

**Legacy syntax (`hyprland.conf`):**

```ini
windowrule = no_focus on, match:class ^$ match:title ^$ match:xwayland true match:float true match:fullscreen false match:pin false
```

---

## HiDPI

If the overlay looks blurry on a scaled monitor, add to your config:

**Lua syntax (`hyprland.lua`):**

```lua
hl.config({
  xwayland = {
    force_zero_scaling = true
  }
})
```

**Legacy syntax (`hyprland.conf`):**

```ini
xwayland {
  force_zero_scaling = true
}
```

Note: this makes XWayland windows unscaled; toolkit-specific scaling may be needed for other apps.

---

## Troubleshooting

- **Black background:** make sure the rule has `opacity 0.99 override ...`. If it persists, try launching with `ELECTRON_OZONE_PLATFORM_HINT=x11` or add `disable-gpu-compositing` to the Electron switches.
- **Cannot drag:** verify the window is running under XWayland (`hyprctl clients` shows `xwayland: 1`).
- **Not on all workspaces:** verify `pin = true` and that the window is floating.
- **Rules not applying:** check the actual `class` and `title` with `hyprctl clients`. The overlay sets `class = opencode-pets-overlay` and `title = OpenCode Pets`. Match your rules against these exact values.
- **`windowrulev2 is deprecated`:** You're on Hyprland 0.55+. Replace `windowrulev2` with `windowrule` and update each field to use `match:` prefix and explicit values (e.g. `float` → `float on`, `nofocus` → `no_focus on`).
- **`invalid field X: missing a value`:** The 0.54+ `windowrule` syntax requires explicit values for every field. Change `float` to `float on`, `pin` to `pin on`, etc.
- **`config option <hl.window_rule<...>> does not exist`:** You're using Lua syntax in a `.conf` file. Either convert to `.lua` or use `windowrule` syntax instead.

---

## Known limitations

- Native Wayland is not supported for this overlay style.
- HiDPI users may need `xwayland { force_zero_scaling = true }`.
- Some NVIDIA GPUs may need `disable-gpu-compositing` for glitch-free transparency.
- The overlay will not appear on lock screens or as a true layer-shell surface.
