import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["src/tui/index.tsx"],
  outdir: "dist",
  naming: "tui.[ext]",
  target: "node",
  format: "esm",
  splitting: false,
  sourcemap: "external",
  external: [
    "@opencode-ai/plugin",
    "@opencode-ai/plugin/*",
    "@opencode-ai/sdk",
    "@opencode-ai/sdk/*",
    "@opentui/core",
    "@opentui/core/*",
    "@opentui/solid",
    "@opentui/solid/*",
    "@opentui/keymap",
    "@opentui/keymap/*",
  ],
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("TUI plugin built:");
for (const output of result.outputs) {
  console.log(`  ${output.path}`);
}
