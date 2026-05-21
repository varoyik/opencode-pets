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
});
