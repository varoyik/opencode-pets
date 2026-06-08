const ALL_MOODS = [
  "idle",
  "working",
  "thinking",
  "waiting",
  "done",
  "error",
] as const;

document.addEventListener("DOMContentLoaded", () => {
  const pet = document.getElementById("pet")!;
  const bubble = document.getElementById("bubble")!;

  if (!pet || !bubble) return;

  const spritesheetUrl = window.electronAPI.getSpritesheetPath();

  if (spritesheetUrl) {
    pet.style.backgroundImage = `url(${spritesheetUrl})`;
    pet.classList.add("state-idle");
  }

  let bubbleDurationMs = 5000;
  let currentMood = "idle";

  function clearMoodClasses(): void {
    for (const m of ALL_MOODS) {
      pet.classList.remove(`state-${m}`);
    }
  }

  function setMood(mood: string): void {
    currentMood = mood;
    clearMoodClasses();
    pet.classList.add(`state-${mood}`);
  }

  window.electronAPI.onMoodChanged((mood: string) => {
    setMood(mood);
  });

  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;

  function showBubble(text: string, duration: number): void {
    if (bubbleTimer !== null) {
      clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }

    bubble.textContent = text;
    bubble.classList.remove("bubble-hidden");

    bubbleTimer = setTimeout(() => {
      bubble.classList.add("bubble-hidden");
      bubbleTimer = null;
    }, duration);
  }

  window.electronAPI.onBubble((text: string, duration: number) => {
    showBubble(text, duration ?? bubbleDurationMs);
  });

  window.electronAPI.onConfigChanged((config) => {
    bubbleDurationMs = config.bubbleDurationMs;
  });

  window.electronAPI.onPetsChanged((_newPets) => {
    // Reserved for future pet selector UI.
  });

  window.electronAPI.onSwitchPet((spritesheetPath: string) => {
    pet.style.backgroundImage = `url(file://${spritesheetPath})`;
  });

  // Context menu: suppress browser default, request native menu from main
  pet.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.electronAPI.showContextMenu();
  });

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  pet.addEventListener("mousedown", (e) => {
    isDragging = true;
    lastX = e.screenX;
    lastY = e.screenY;
    pet.classList.add("dragging");
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.screenX - lastX;
    const dy = e.screenY - lastY;
    const velocity = e.screenX - lastX;

    // Directional animation based on drag velocity
    if (velocity < -5) {
      clearMoodClasses();
      pet.classList.remove("run-right");
      pet.classList.add("run-left");
    } else if (velocity > 5) {
      clearMoodClasses();
      pet.classList.remove("run-left");
      pet.classList.add("run-right");
    } else {
      pet.classList.remove("run-left");
      pet.classList.remove("run-right");
      pet.classList.add(`state-${currentMood}`);
    }

    lastX = e.screenX;
    lastY = e.screenY;
    window.electronAPI.sendDragDelta(dx, dy);
  });

  window.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      pet.classList.remove("dragging");
      pet.classList.remove("run-left");
      pet.classList.remove("run-right");
      pet.classList.add(`state-${currentMood}`);
    }
  });
});
