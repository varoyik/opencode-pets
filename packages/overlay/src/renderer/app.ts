const ALL_MOODS = [
  "idle",
  "working",
  "thinking",
  "waiting",
  "done",
  "error",
] as const;

const ACTIVE_MOODS = new Set(["thinking", "working", "waiting"]);

const MOOD_TITLES: Record<string, string> = {
  idle: "Idle",
  working: "Working...",
  thinking: "Thinking...",
  waiting: "Waiting...",
  done: "Done!",
  error: "Error!",
};

const CHECKMARK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const CROSS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

document.addEventListener("DOMContentLoaded", () => {
  const pet = document.getElementById("pet")!;
  const bubble = document.getElementById("bubble")!;
  const bubbleTitle = bubble.querySelector(".bubble-title") as HTMLElement;
  const bubbleBody = bubble.querySelector(".bubble-body") as HTMLElement;
  const bubbleIcon = bubble.querySelector(".bubble-icon") as HTMLElement;

  if (!pet || !bubble) return;

  const spritesheetUrl = window.electronAPI.getSpritesheetPath();

  if (spritesheetUrl) {
    pet.style.backgroundImage = `url(${spritesheetUrl})`;
    pet.classList.add("state-idle");
  }

  let bubbleDurationMs = 5000;
  let currentMood = "idle";
  let bubbleManuallyHidden = false;

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

  function getIconHtml(mood: string): string {
    if (ACTIVE_MOODS.has(mood)) {
      return `<div class="spinner"></div>`;
    }
    if (mood === "done") {
      return `<span class="icon-done">${CHECKMARK_SVG}</span>`;
    }
    if (mood === "error") {
      return `<span class="icon-error">${CROSS_SVG}</span>`;
    }
    return "";
  }

  function showBubble(text: string, duration: number): void {
    if (bubbleTimer !== null) {
      clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }

    const title = MOOD_TITLES[currentMood] ?? currentMood;
    bubbleTitle.textContent = title;
    bubbleBody.textContent = text;
    bubbleIcon.innerHTML = getIconHtml(currentMood);

    if (!bubbleManuallyHidden) {
      bubble.classList.remove("bubble-hidden");
    }

    // Only auto-hide for non-active moods
    if (!ACTIVE_MOODS.has(currentMood)) {
      bubbleTimer = setTimeout(() => {
        bubble.classList.add("bubble-hidden");
        bubbleTimer = null;
      }, duration);
    }
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
    const isBubbleVisible = !bubble.classList.contains("bubble-hidden");
    window.electronAPI.showContextMenu(isBubbleVisible);
  });

  // Toggle bubble visibility via context menu
  window.electronAPI.onToggleBubble(() => {
    if (bubble.classList.contains("bubble-hidden")) {
      bubble.classList.remove("bubble-hidden");
      bubbleManuallyHidden = false;
    } else {
      bubble.classList.add("bubble-hidden");
      bubbleManuallyHidden = true;
      if (bubbleTimer !== null) {
        clearTimeout(bubbleTimer);
        bubbleTimer = null;
      }
    }
  });

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let bubbleRestoreText: string | null = null;
  let bubbleRestoreDuration: number = bubbleDurationMs;
  let wasManuallyHiddenBeforeDrag = false;
  let dragStartMood = currentMood;

  pet.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // Only left-click starts drag
    isDragging = true;
    lastX = e.screenX;
    lastY = e.screenY;
    dragStartMood = currentMood;
    pet.classList.add("dragging");
    // Hide bubble during drag, save state for restore
    if (!bubble.classList.contains("bubble-hidden")) {
      bubbleRestoreText = bubbleBody.textContent;
      bubbleRestoreDuration = bubbleDurationMs;
      wasManuallyHiddenBeforeDrag = false;
      bubble.classList.add("bubble-hidden");
    } else {
      bubbleRestoreText = null;
      wasManuallyHiddenBeforeDrag = bubbleManuallyHidden;
    }
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
      // Restore bubble if it was visible before drag and mood hasn't changed
      if (
        bubbleRestoreText !== null &&
        !wasManuallyHiddenBeforeDrag &&
        currentMood === dragStartMood
      ) {
        showBubble(bubbleRestoreText, bubbleRestoreDuration);
        bubbleRestoreText = null;
      }
    }
  });
});
