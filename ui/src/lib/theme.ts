export type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "stowge_theme";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "dark" || value === "light";
}

export function getStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : "dark";
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: ThemeMode): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

export function initializeTheme(): ThemeMode {
  const theme = getStoredTheme();
  applyTheme(theme);
  return theme;
}
