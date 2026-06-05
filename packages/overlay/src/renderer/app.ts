const ALL_MOODS = [
  "idle",
  "working",
  "thinking",
  "waiting",
  "done",
  "error",
] as const;

document.addEventListener("DOMContentLoaded", () => {
  const petDiv = document.getElementById("pet");
  const bubbleDiv = document.getElementById("bubble");

  if (!petDiv || !bubbleDiv) return;

  const spritesheetUrl = window.electronAPI.getSpritesheetPath();

  if (spritesheetUrl) {
    petDiv.style.backgroundImage = `url(${spritesheetUrl})`;
    petDiv.classList.add("state-idle");
  }

  function setMood(mood: string): void {
    for (const m of ALL_MOODS) {
      petDiv!.classList.remove(`state-${m}`);
    }
    petDiv!.classList.add(`state-${mood}`);
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

    bubbleDiv!.textContent = text;
    bubbleDiv!.classList.remove("bubble-hidden");

    bubbleTimer = setTimeout(() => {
      bubbleDiv!.classList.add("bubble-hidden");
      bubbleTimer = null;
    }, duration);
  }

  window.electronAPI.onBubble((text: string, duration: number) => {
    showBubble(text, duration);
  });

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  petDiv.addEventListener("mousedown", (e) => {
    isDragging = true;
    lastX = e.screenX;
    lastY = e.screenY;
    petDiv.classList.add("dragging");
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.screenX - lastX;
    const dy = e.screenY - lastY;
    lastX = e.screenX;
    lastY = e.screenY;
    window.electronAPI.sendDragDelta(dx, dy);
  });

  window.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      petDiv.classList.remove("dragging");
    }
  });
});
