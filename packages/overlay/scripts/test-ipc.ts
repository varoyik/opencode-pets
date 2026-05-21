import { createConnection } from "node:net";
import { resolve } from "node:path";

const SOCKET_DIR = resolve(`/tmp/opencode-pets-${process.getuid?.() ?? "0"}`);
const SOCKET_PATH = resolve(SOCKET_DIR, "opencode-pets.sock");

const VALID_MOODS = [
  "idle",
  "working",
  "thinking",
  "waiting",
  "done",
  "error",
] as const;

function send(conn: ReturnType<typeof createConnection>, msg: unknown): void {
  const line = JSON.stringify(msg) + "\n";
  conn.write(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`Connecting to ${SOCKET_PATH} ...`);

  const conn = createConnection(SOCKET_PATH, () => {
    console.log("✓ Connected.\n");
  });

  conn.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      console.error(
        `✗ Socket not found at ${SOCKET_PATH}. Is the Electron overlay running?`,
      );
    } else {
      console.error("✗ Connection error:", err.message);
    }
    process.exit(1);
  });

  await new Promise<void>((resolve) => {
    if (conn.readyState === "open") {
      resolve();
    } else {
      conn.once("connect", resolve);
    }
  });

  await sleep(200);

  console.log("─── Test 1: set_mood ───");
  for (const mood of VALID_MOODS) {
    console.log(`  Sending set_mood → "${mood}"`);
    send(conn, { type: "set_mood", payload: { mood } });
    await sleep(1500);
  }

  console.log("\n─── Test 2: show_bubble ───");
  console.log('  Sending show_bubble → "Hello from opencode-pets! 🎉"');
  send(conn, {
    type: "show_bubble",
    payload: { text: "Hello from opencode-pets! 🎉", duration: 3000 },
  });
  await sleep(4000);

  console.log('  Sending show_bubble → "Another bubble — auto-dismiss in 5s"');
  send(conn, {
    type: "show_bubble",
    payload: {
      text: "Another bubble — auto-dismiss in 5s",
      duration: 5000,
    },
  });
  await sleep(2500);

  console.log('  Sending replacement bubble → "Replaced!"');
  send(conn, {
    type: "show_bubble",
    payload: { text: "Replaced!", duration: 2000 },
  });
  await sleep(3000);

  console.log("\n─── Test 3: toggle_visibility ───");
  console.log("  Hiding window...");
  send(conn, { type: "toggle_visibility", payload: {} });
  await sleep(2000);

  console.log("  Showing window...");
  send(conn, { type: "toggle_visibility", payload: {} });
  await sleep(2000);

  console.log("  Hiding window (again)...");
  send(conn, { type: "toggle_visibility", payload: {} });
  await sleep(1500);

  console.log("  Showing window (again)...");
  send(conn, { type: "toggle_visibility", payload: {} });
  await sleep(1000);

  console.log("\n─── Test 4: Error handling ───");

  console.log('  Sending invalid mood → "unknown" (should be dropped)');
  send(conn, { type: "set_mood", payload: { mood: "unknown" } });
  await sleep(500);

  console.log("  Sending malformed JSON → raw text (should be dropped)");
  conn.write("not json\n");
  await sleep(500);

  console.log("  Sending missing type field (should be dropped)");
  send(conn, { payload: { mood: "idle" } });
  await sleep(500);

  console.log("\n─── Reset ───");
  console.log('  Sending set_mood → "idle"');
  send(conn, { type: "set_mood", payload: { mood: "idle" } });
  await sleep(500);

  console.log("\n✓ All tests completed.");
  conn.end();
}

main();
