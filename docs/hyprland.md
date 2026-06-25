# Hyprland Setup for OpenCode Pets

The overlay runs under XWayland with WM_CLASS `opencode-pets-overlay`. Add the window rules below for proper transparency, pinning, and no-focus behavior.

---

## Which config format do you have?

Hyprland 0.55+ selects its config parser **purely by file extension**:

- **`.lua`** → Lua parser (understands `hl.window_rule({...})`)
- **`.conf`** → legacy parser (understands `windowrule`, NOT `windowrulev2`)

**You cannot mix syntaxes.** Pick the path that matches your config file:

- [I have `hyprland.lua` — use Lua syntax](#window-rules-lua-syntax)
- [I have `hyprland.conf` — use legacy syntax](#window-rules-legacy-syntax)

> **Important:** On Hyprland 0.55+, `windowrulev2` is **hard-deprecated**. The legacy parser returns an immediate error for it. Use `windowrule` instead.

---

## Window rules (Lua syntax)

Add to `~/.config/hypr/hyprland.lua`:

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
    no_follow_mouse = true,
    opacity = "0.99 override 0.99 override 0.99 override",
    suppress_event = "activatefocus",
})
```

---

## Window rules (legacy syntax)

Add to `~/.config/hypr/hyprland.conf`. **Do not use `windowrulev2`** — that keyword is dead on 0.55+.

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
windowrule = no_follow_mouse on, match:class opencode-pets-overlay
windowrule = suppress_event activatefocus, match:class opencode-pets-overlay
```

Or use the block-style syntax:

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
    no_follow_mouse = on
    suppress_event = activatefocus
}
```

---

## Finding the correct class

If the rules don't apply, find the actual class with:

```bash
hyprctl clients | grep -i "class.*opencode\|title.*pet"
```

Then update the `match:class` regex accordingly.

---

## Troubleshooting

- **Black background:** make sure the rule has `opacity 0.99 override ...`. If it persists, try `ELECTRON_OZONE_PLATFORM_HINT=x11` or add `disable-gpu-compositing` to the Electron switches.
- **Cannot drag:** verify the window is running under XWayland (`hyprctl clients` shows `xwayland: 1`).
- **Not on all workspaces:** verify `pin = true` and that the window is floating.
- **Workspace confusion / cross-workspace tooltips:** remove any `stay_focused` or `no_focus` rules for the overlay. The recommended rules use `no_initial_focus`, `no_follow_mouse`, and `suppress_event activatefocus` instead.
- **Rules not applying:** check the actual `class` and `title` with `hyprctl clients`. The overlay sets `class = opencode-pets-overlay` and `title = OpenCode Pets`.
- **`windowrulev2 is deprecated`:** You're on Hyprland 0.55+. Replace `windowrulev2` with `windowrule` and update each field to use `match:` prefix and explicit values (e.g. `float` → `float on`, `nofocus` → `no_focus on`).
- **`invalid field X: missing a value`:** The 0.54+ `windowrule` syntax requires explicit values. Change `float` to `float on`, `pin` to `pin on`, etc.
- **`config option <hl.window_rule<...>> does not exist`:** You're using Lua syntax in a `.conf` file. Either convert to `.lua` or use `windowrule` syntax instead.
