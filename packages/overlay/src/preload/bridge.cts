const { contextBridge, ipcRenderer } = require("electron");

const prefix = "--spritesheet-path=";
const spritesheetArg = process.argv.find((arg: string) =>
  arg.startsWith(prefix),
);
const spritesheetPath = spritesheetArg
  ? spritesheetArg.slice(prefix.length)
  : "";

contextBridge.exposeInMainWorld("electronAPI", {
  getSpritesheetPath: (): string => `file://${spritesheetPath}`,
  onMoodChanged: (callback: (mood: string) => void): void => {
    ipcRenderer.on("mood-changed", (_event: any, mood: string) =>
      callback(mood),
    );
  },
  onBubble: (callback: (text: string, duration: number) => void): void => {
    ipcRenderer.on(
      "show-bubble",
      (_event: any, text: string, duration: number) => callback(text, duration),
    );
  },
  sendDragDelta: (dx: number, dy: number): void => {
    ipcRenderer.send("drag-delta", dx, dy);
  },
});
