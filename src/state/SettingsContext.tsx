import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AppTheme } from "../types";

type SettingsContextValue = {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readTheme(): AppTheme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("apchi-theme");
  } catch {}
  if (stored === "light" || stored === "dark") return stored;

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("apchi-theme", theme);
    } catch {}

    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "light" ? "#f1ebe1" : "#241c2d");
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context)
    throw new Error("useSettings must be used inside SettingsProvider");
  return context;
}
