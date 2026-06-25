interface PetManifest {
  id: string;
  displayName: string;
  description?: string;
  spritesheetPath: string;
}

interface MenuState {
  bubbleVisible: boolean;
  currentPetId: string;
  pets: PetManifest[];
}

const PET_PAW_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="9" cy="7" rx="2.5" ry="3"/><ellipse cx="15" cy="7" rx="2.5" ry="3"/><ellipse cx="6" cy="13" rx="2.5" ry="3"/><ellipse cx="18" cy="13" rx="2.5" ry="3"/><path d="M12 22c4.5 0 7-3.5 7-7 0-3-2.5-6-7-6s-7 3-7 6c0 3.5 2.5 7 7 7z"/></svg>`;
const EYE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const MINUS_SQUARE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
const POWER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`;
const CHEVRON_RIGHT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("menu-container")!;
  const menuPanel = document.getElementById("context-menu-panel")!;
  const menuSubmenu = document.getElementById("context-submenu")!;

  if (!container || !menuPanel || !menuSubmenu) return;

  let petList: PetManifest[] = [];
  let currentPetId = "";
  let bubbleVisible = true;

  function escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return text.replace(/[&<>"']/g, (c) => map[c] ?? c);
  }

  function createMenuItem(options: {
    icon?: string;
    label: string;
    active?: boolean;
    hasSubmenu?: boolean;
    onClick: () => void;
  }): HTMLElement {
    const item = document.createElement("div");
    item.className = "context-menu-item";
    if (options.active) item.classList.add("active");

    if (options.icon) {
      const iconSpan = document.createElement("span");
      iconSpan.className = "item-icon";
      iconSpan.innerHTML = options.icon;
      item.appendChild(iconSpan);
    }
    const labelSpan = document.createElement("span");
    labelSpan.className = "item-label";
    labelSpan.textContent = escapeHtml(options.label);
    item.appendChild(labelSpan);
    if (options.hasSubmenu) {
      const chevronSpan = document.createElement("span");
      chevronSpan.className = "item-chevron";
      chevronSpan.innerHTML = CHEVRON_RIGHT_ICON;
      item.appendChild(chevronSpan);
    }

    item.addEventListener("mousedown", (e) => e.stopPropagation());
    item.addEventListener("click", options.onClick);
    return item;
  }

  function closeMenu(): void {
    window.electronAPI.closeMenu();
  }

  function buildSubmenu(): void {
    menuSubmenu.innerHTML = "";
    for (const petItem of petList) {
      const isActive = petItem.id === currentPetId;
      const item = createMenuItem({
        label: petItem.displayName,
        active: isActive,
        onClick: () => {
          window.electronAPI.requestSwitchPet(petItem.id);
          closeMenu();
        },
      });

      const icon = document.createElement("span");
      icon.className = "pet-icon";
      icon.style.backgroundImage = `url(file://${petItem.spritesheetPath})`;
      item.insertBefore(icon, item.firstChild);

      menuSubmenu.appendChild(item);
    }
  }

  function toggleSubmenu(): void {
    if (menuSubmenu.classList.contains("submenu-open")) {
      menuSubmenu.classList.remove("submenu-open");
      reportSize();
      return;
    }

    buildSubmenu();
    menuSubmenu.classList.add("submenu-open");
    reportSize();
  }

  function buildMainMenu(): void {
    menuPanel.innerHTML = "";
    menuSubmenu.innerHTML = "";
    menuSubmenu.classList.remove("submenu-open");

    menuPanel.appendChild(
      createMenuItem({
        icon: PET_PAW_ICON,
        label: "Switch Pet",
        hasSubmenu: true,
        onClick: toggleSubmenu,
      }),
    );
    menuPanel.appendChild(document.createElement("div")).className =
      "context-menu-separator";
    menuPanel.appendChild(
      createMenuItem({
        icon: EYE_ICON,
        label: bubbleVisible ? "Hide Bubble" : "Show Bubble",
        onClick: () => {
          window.electronAPI.toggleBubble();
          closeMenu();
        },
      }),
    );
    menuPanel.appendChild(document.createElement("div")).className =
      "context-menu-separator";
    menuPanel.appendChild(
      createMenuItem({
        icon: MINUS_SQUARE_ICON,
        label: "Hide Pet",
        onClick: () => {
          window.electronAPI.hidePet();
          closeMenu();
        },
      }),
    );
    menuPanel.appendChild(
      createMenuItem({
        icon: POWER_ICON,
        label: "Quit Pet",
        onClick: () => {
          window.electronAPI.quitPet();
          closeMenu();
        },
      }),
    );
  }

  function reportSize(): void {
    setTimeout(() => {
      const width = document.documentElement.scrollWidth;
      const height = document.documentElement.scrollHeight;
      window.electronAPI.reportSize({ width, height });
    }, 0);
  }

  // Prevent native context menu on the menu window itself
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  document.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });

  window.electronAPI.onMenuState((state: MenuState) => {
    petList = state.pets;
    currentPetId = state.currentPetId;
    bubbleVisible = state.bubbleVisible;
    buildMainMenu();
    reportSize();
  });

  window.electronAPI.onMenuEscape(() => {
    closeMenu();
  });

  window.electronAPI.ready();
});
