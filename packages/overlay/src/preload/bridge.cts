const { contextBridge } = require("electron");

const prefix = "--spritesheet-path=";
const spritesheetArg = process.argv.find((arg: string) =>
  arg.startsWith(prefix),
);
const spritesheetPath = spritesheetArg
  ? spritesheetArg.slice(prefix.length)
  : "";

contextBridge.exposeInMainWorld("electronAPI", {
  getSpritesheetPath: (): string => `file://${spritesheetPath}`,
});
