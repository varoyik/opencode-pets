import type { PluginModule } from "@opencode-ai/plugin";
import type { Plugin as V2Plugin } from "@opencode/plugin";
import { v1Server } from "./v1.js";
import { v2Setup } from "./v2.js";

/**
 * Dual-mode plugin module.
 *
 * - V1 (OpenCode >= 1.18.29) reads this as a server plugin module: `server`
 *   runs and the extra `setup` key is ignored.
 * - V2 (OpenCode 2.x) reads this as a plugin definition: `setup` runs and the
 *   extra `server` key is ignored.
 */
const plugin = {
  id: "opencode-pets",
  server: v1Server,
  setup: v2Setup,
} satisfies PluginModule & Pick<V2Plugin.Plugin, "setup">;

export default plugin;
