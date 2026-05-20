/**
 * Vanilla JS renderer for the OpenCode Pet overlay.
 * Responsibilities:
 *  - Load the spritesheet path from the preload bridge
 *  - Apply it as background-image on the pet <div>
 *  - Start the idle animation by adding the state-idle CSS class
 */

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof window.electronAPI?.getSpritesheetPath !== "function") {
    console.error(
      "electronAPI.getSpritesheetPath is not available. Is the preload bridge loaded?",
    );
    return;
  }

  // IPC invoke returns a Promise (sandboxed preload can't use node:path).
  const spritesheetUrl = await window.electronAPI.getSpritesheetPath();
  const pet = document.getElementById("pet");

  if (!pet) {
    console.error("Pet element not found in DOM.");
    return;
  }

  // Set the spritesheet as background-image and start the idle animation.
  pet.style.backgroundImage = `url(${spritesheetUrl})`;
  pet.classList.add("state-idle");
});
