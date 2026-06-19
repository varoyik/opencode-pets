import { cpSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname ?? ".", "..");

const distRenderer = resolve(root, "dist/renderer");
const srcRenderer = resolve(root, "src/renderer");

cpSync(resolve(srcRenderer, "index.html"), resolve(distRenderer, "index.html"));
cpSync(resolve(srcRenderer, "style.css"), resolve(distRenderer, "style.css"));
cpSync(
  resolve(srcRenderer, "context-menu.html"),
  resolve(distRenderer, "context-menu.html"),
);
cpSync(
  resolve(srcRenderer, "context-menu.css"),
  resolve(distRenderer, "context-menu.css"),
);
