const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onMenuState: (callback: (state: unknown) => void): void => {
    ipcRenderer.on("menu-state", (_event: unknown, state: unknown) =>
      callback(state),
    );
  },
  reportSize: (size: { width: number; height: number }): void => {
    ipcRenderer.send("menu-size", size);
  },
  ready: (): void => {
    ipcRenderer.send("menu-ready");
  },
  closeMenu: (): void => {
    ipcRenderer.send("close-context-menu");
  },
  hidePet: (): void => {
    ipcRenderer.send("hide-pet");
  },
  quitPet: (): void => {
    ipcRenderer.send("quit-pet");
  },
  requestSwitchPet: (petId: string): void => {
    ipcRenderer.send("request-switch-pet", petId);
  },
  toggleBubble: (): void => {
    ipcRenderer.send("toggle-bubble");
  },
  onMenuEscape: (callback: () => void): void => {
    ipcRenderer.on("menu-escape", () => callback());
  },
});
