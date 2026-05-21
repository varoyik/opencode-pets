export interface IElectronAPI {
  getSpritesheetPath: () => string;
  onMoodChanged: (callback: (mood: string) => void) => void;
  onBubble: (callback: (text: string, duration: number) => void) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
