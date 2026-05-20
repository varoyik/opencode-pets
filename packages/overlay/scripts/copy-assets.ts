import { cpSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname ?? ".", "..");

const distRenderer = resolve(root, "dist/renderer");
const srcRenderer = resolve(root, "src/renderer");

cpSync(resolve(srcRenderer, "index.html"), resolve(distRenderer, "index.html"));
cpSync(resolve(srcRenderer, "style.css"), resolve(distRenderer, "style.css"));
