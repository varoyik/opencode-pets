import { IpcClient } from "../src/ipc-client.js";

function getSocketPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  return `/tmp/opencode-pets-${uid}/opencode-pets.sock`;
}

async function main() {
  const socketPath = getSocketPath();
  console.log(`Using socket: ${socketPath}`);

  console.log("Creating IpcClient...");
  const client = new IpcClient(socketPath);
  console.log("✓ IpcClient created (lazy connection — connects on first send)");

  console.log("\n─── Test 1: sendMood ───");
  console.log('  Sending mood → "working"');
  client.sendMood("working");
  console.log("  Sent!");
  await Bun.sleep(2000);

  console.log("\n─── Test 2: sendBubble ───");
  console.log('  Sending bubble → "test" (3000ms)');
  client.sendBubble("test", 3000);
  console.log("  Sent!");
  await Bun.sleep(4000);

  console.log("\n─── Test 3: toggleVisibility ───");
  console.log("  Toggling visibility (hide)...");
  client.toggleVisibility();
  console.log("  Sent!");
  await Bun.sleep(2000);

  console.log("  Toggling visibility (show)...");
  client.toggleVisibility();
  console.log("  Sent!");
  await Bun.sleep(1000);

  console.log("\n✓ All tests completed.");
  client.close();
  console.log("✓ IpcClient closed.");
}

main().catch((err) => {
  console.error("✗ Test script failed:", err.message);
  process.exit(1);
});
