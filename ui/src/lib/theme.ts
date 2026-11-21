import { useSyncExternalStore } from "react";
import { apiRequest } from "./api";

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

/** The theme the page is showing right now, kept in step with the data-theme attribute. */
export function currentTheme(): ThemeMode {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** React hook: re-renders when the theme changes, from any control. */
export function useTheme(): ThemeMode {
  return useSyncExternalStore(subscribeToTheme, currentTheme, () => "dark");
}

/** A user's choice: show it straight away, remember it in this browser and on their account (best effort). */
export function chooseTheme(theme: ThemeMode): void {
  setTheme(theme);
  void apiRequest("/api/me", { method: "PATCH", body: JSON.stringify({ theme }) }).catch(() => {
    // Best effort: the choice still applies here.
  });
}
