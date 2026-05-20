document.addEventListener("DOMContentLoaded", () => {
  const petDiv = document.getElementById("pet");

  if (!petDiv) return;

  const spritesheetUrl = window.electronAPI.getSpritesheetPath();

  if (spritesheetUrl) {
    petDiv.style.backgroundImage = `url(${spritesheetUrl})`;
    petDiv.classList.add("state-idle");
  }
});
