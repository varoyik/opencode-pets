export interface PetManifest {
  id: string;
  displayName: string;
  description?: string;
  spritesheetPath: string;
}

export interface Config {
  defaultPet: string;
  idleTimeoutMs: number;
  bubbleDurationMs: number;
}

export interface IElectronAPI {
  getSpritesheetPath: () => string;
  onMoodChanged: (callback: (mood: string) => void) => void;
  onBubble: (callback: (text: string, duration: number) => void) => void;
  onConfigChanged: (callback: (config: Config) => void) => void;
  onPetsChanged: (callback: (pets: PetManifest[]) => void) => void;
  onSwitchPet: (callback: (spritesheetPath: string) => void) => void;
  requestSwitchPet: (petId: string) => void;
  sendDragDelta: (dx: number, dy: number) => void;
  showContextMenu: () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
