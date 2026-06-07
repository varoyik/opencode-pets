import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { ipcMain, type BrowserWindow } from "electron";
import { parseIpcMessage } from "@opencode-pets/core";

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
              console.warn("[ipc-server] Invalid JSON:", trimmed);
              continue;
            }

            const msg = parseIpcMessage(raw);
            if (!msg) {
              console.warn("[ipc-server] Invalid IPC message:", trimmed);
              continue;
            }

            switch (msg.type) {
              case "set_mood":
                if (!browserWindow.isDestroyed()) {
                  browserWindow.webContents.send(
                    "mood-changed",
                    msg.payload.mood,
                  );
                }
                break;

              case "show_bubble":
                if (!browserWindow.isDestroyed()) {
                  browserWindow.webContents.send(
                    "show-bubble",
                    msg.payload.text,
                    msg.payload.duration ?? 5000,
                  );
                }
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
                if (!browserWindow.isDestroyed()) {
                  browserWindow.webContents.send("config-changed", msg.payload);
                }
                break;

              case "set_pets":
                if (!browserWindow.isDestroyed()) {
                  browserWindow.webContents.send(
                    "pets-changed",
                    msg.payload.pets,
                  );
                }
                break;

              case "switch_pet":
                if (!browserWindow.isDestroyed()) {
                  browserWindow.webContents.send(
                    "switch-pet",
                    msg.payload.spritesheetPath,
                  );
                }
                break;
            }
          }
        });

        socket.on("error", (err: Error) => {
          console.warn("[ipc-server] Socket error:", err.message);
        });
      });

      // Forward renderer pet switch requests to plugin via socket
      ipcMain.on("request-switch-pet", (_event, petId: string) => {
        const msg =
          JSON.stringify({
            type: "switch_pet",
            payload: { petId },
          }) + "\n";
        for (const socket of sockets) {
          try {
            socket.write(msg);
          } catch (err) {
            console.warn("[ipc-server] Failed to forward switch_pet:", err);
          }
        }
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
