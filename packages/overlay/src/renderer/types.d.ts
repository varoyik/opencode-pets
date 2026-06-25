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
  onSwitchPet: (
    callback: (petId: string, spritesheetPath: string) => void,
  ) => void;
  sendDragDelta: (dx: number, dy: number) => void;
  sendDragEnd: (vx: number, vy: number) => void;
  onThrowEnd: (callback: () => void) => void;
  onToggleBubble: (callback: () => void) => void;
  openContextMenu: (state: {
    bubbleVisible: boolean;
    currentPetId: string;
    pets: PetManifest[];
  }) => void;
  closeContextMenu: () => void;

  onMenuState: (
    callback: (state: {
      bubbleVisible: boolean;
      currentPetId: string;
      pets: PetManifest[];
    }) => void,
  ) => void;
  reportSize: (size: { width: number; height: number }) => void;
  ready: () => void;
  closeMenu: () => void;
  hidePet: () => void;
  quitPet: () => void;
  requestSwitchPet: (petId: string) => void;
  toggleBubble: () => void;
  onMenuEscape: (callback: () => void) => void;
}

export interface IMenuWindowAPI {
  onMenuState: (
    callback: (state: {
      bubbleVisible: boolean;
      currentPetId: string;
      pets: PetManifest[];
    }) => void,
  ) => void;
  reportSize: (size: { width: number; height: number }) => void;
  ready: () => void;
  closeMenu: () => void;
  hidePet: () => void;
  quitPet: () => void;
  requestSwitchPet: (petId: string) => void;
  toggleBubble: () => void;
  onMenuEscape: (callback: () => void) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI & IMenuWindowAPI;
  }
}
