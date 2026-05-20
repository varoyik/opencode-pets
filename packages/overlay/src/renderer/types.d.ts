export interface IElectronAPI {
  getSpritesheetPath: () => string;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
