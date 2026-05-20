import { app } from "electron";
import { createWindow } from "./window.js";

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Secondary instance already quit via !gotLock above.
    // No need to quit the primary — just ignore. Could notify
    // the renderer for a visual "already here" cue in the future.
  });

  app.dock?.hide();

  app.whenReady().then(() => {
    createWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
