import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { ipcMain, type BrowserWindow, Menu, app } from "electron";
import { parseIpcMessage } from "@opencode-pets/core";
import type { PetManifest } from "@opencode-pets/core";

let petList: PetManifest[] = [];
let currentPetId = "";

export interface SocketServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Create a Unix domain socket server that listens for JSON IPC messages
 * from the plugin and forwards commands to the renderer.
 *
 * Returns { start(), stop() } for lifecycle management.
 */
export function createSocketServer(
  socketPath: string,
  browserWindow: BrowserWindow,
): SocketServer {
  let server: net.Server | null = null;
  const sockets = new Set<net.Socket>();

  function broadcast(msg: string): void {
    for (const socket of sockets) {
      try {
        socket.write(msg);
      } catch (err) {}
    }
  }

  function sendToRenderer(channel: string, ...args: unknown[]): void {
    if (!browserWindow.isDestroyed()) {
      browserWindow.webContents.send(channel, ...args);
    }
  }

  function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(socketPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      // Remove stale socket from crashed instance (single-instance lock guarantees safety)
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ENOENT
      }

      server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));

        let buffer = "";

        socket.setEncoding("utf-8");

        socket.on("data", (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "") continue;

            let raw: unknown;
            try {
              raw = JSON.parse(trimmed);
            } catch {
              continue;
            }

            const msg = parseIpcMessage(raw);
            if (!msg) {
              continue;
            }

            switch (msg.type) {
              case "set_mood":
                sendToRenderer("mood-changed", msg.payload.mood);
                break;

              case "show_bubble":
                sendToRenderer(
                  "show-bubble",
                  msg.payload.text,
                  msg.payload.duration ?? 5000,
                );
                break;

              case "toggle_visibility":
                if (!browserWindow.isDestroyed()) {
                  if (browserWindow.isVisible()) {
                    browserWindow.hide();
                  } else {
                    browserWindow.show();
                  }
                }
                break;

              case "set_config":
                sendToRenderer("config-changed", msg.payload);
                break;

              case "set_pets":
                petList = msg.payload.pets;
                sendToRenderer("pets-changed", msg.payload.pets);
                break;

              case "switch_pet":
                if (msg.payload.petId) {
                  currentPetId = msg.payload.petId;
                }
                sendToRenderer("switch-pet", msg.payload.spritesheetPath);
                break;
            }
          }
        });

        socket.on("error", (_err: Error) => {
          // Silently ignore socket errors — plugin handles reconnection.
        });
      });

      // Forward renderer pet switch requests to plugin via socket
      ipcMain.on("request-switch-pet", (_event, petId: string) => {
        broadcast(
          JSON.stringify({ type: "switch_pet", payload: { petId } }) + "\n",
        );
      });

      // Show native context menu on right-click from renderer
      ipcMain.on("show-context-menu", (_event, isBubbleVisible: boolean) => {
        const template: Electron.MenuItemConstructorOptions[] = [
          {
            label: "Switch Pet",
            submenu: petList.map((pet) => ({
              label: pet.displayName,
              type: "checkbox" as const,
              checked: pet.id === currentPetId,
              click: () => {
                broadcast(
                  JSON.stringify({
                    type: "switch_pet",
                    payload: { petId: pet.id },
                  }) + "\n",
                );
              },
            })),
          },
          { type: "separator" },
          {
            label: isBubbleVisible ? "Hide Bubble" : "Show Bubble",
            click: () => {
              sendToRenderer("toggle-bubble");
            },
          },
          { type: "separator" },
          {
            label: "Hide Pet",
            click: () => {
              if (!browserWindow.isDestroyed()) {
                browserWindow.hide();
              }
              broadcast(JSON.stringify({ type: "hidden", payload: {} }) + "\n");
            },
          },
          {
            label: "Quit Pet",
            click: () => {
              broadcast(
                JSON.stringify({ type: "quit_pet", payload: {} }) + "\n",
              );
              app.quit();
            },
          },
        ];

        const menu = Menu.buildFromTemplate(template);
        menu.popup();
      });

      // Bun types omit EventEmitter; Electron's runtime has it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server as any).on("error", (err: Error) => {
        reject(err);
      });

      server.listen(socketPath, () => {
        try {
          fs.chmodSync(socketPath, 0o600);
        } catch (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  function stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }

      // Prevent rejections from error events during close
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server as any).removeAllListeners("error");

      ipcMain.removeAllListeners("request-switch-pet");
      ipcMain.removeAllListeners("show-context-menu");

      for (const socket of sockets) socket.destroy();
      sockets.clear();

      server.close(() => {
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // ENOENT
        }
        server = null;
        resolve();
      });
    });
  }

  return { start, stop };
}
