import { contextBridge, ipcRenderer } from "electron";

// Sandboxed preload scripts cannot use Node.js APIs (node:path, node:url, etc.).
// The spritesheet path is computed in the main process and requested via IPC.
contextBridge.exposeInMainWorld("electronAPI", {
  getSpritesheetPath: () => ipcRenderer.invoke("get-spritesheet-path"),
});
