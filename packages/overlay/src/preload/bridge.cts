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
  onConfigChanged: (
    callback: (config: {
      defaultPet: string;
      idleTimeoutMs: number;
      bubbleDurationMs: number;
    }) => void,
  ): void => {
    ipcRenderer.on(
      "config-changed",
      (
        _event: any,
        config: {
          defaultPet: string;
          idleTimeoutMs: number;
          bubbleDurationMs: number;
        },
      ) => callback(config),
    );
  },
  onPetsChanged: (
    callback: (
      pets: {
        id: string;
        displayName: string;
        description?: string;
        spritesheetPath: string;
      }[],
    ) => void,
  ): void => {
    ipcRenderer.on(
      "pets-changed",
      (
        _event: any,
        pets: {
          id: string;
          displayName: string;
          description?: string;
          spritesheetPath: string;
        }[],
      ) => callback(pets),
    );
  },
  onSwitchPet: (callback: (spritesheetPath: string) => void): void => {
    ipcRenderer.on("switch-pet", (_event: any, spritesheetPath: string) =>
      callback(spritesheetPath),
    );
  },
  requestSwitchPet: (petId: string): void => {
    ipcRenderer.send("request-switch-pet", petId);
  },
  sendDragDelta: (dx: number, dy: number): void => {
    ipcRenderer.send("drag-delta", dx, dy);
  },
  showContextMenu: (isBubbleVisible: boolean): void => {
    ipcRenderer.send("show-context-menu", isBubbleVisible);
  },
  onToggleBubble: (callback: () => void): void => {
    ipcRenderer.on("toggle-bubble", (_event: any) => callback());
  },
});
