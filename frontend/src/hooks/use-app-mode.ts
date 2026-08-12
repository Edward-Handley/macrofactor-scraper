import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { createElement } from "react";

export type AppMode = "cut" | "performance";

interface AppModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
}

const AppModeContext = createContext<AppModeContextValue>({
  mode: "cut",
  setMode: () => {},
  toggleMode: () => {},
});

function getStoredMode(): AppMode {
  try {
    const stored = localStorage.getItem("app_mode");
    return stored === "performance" ? "performance" : "cut";
  } catch {
    return "cut";
  }
}

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(getStoredMode);

  const setMode = useCallback((next: AppMode) => {
    setModeState(next);
    try {
      localStorage.setItem("app_mode", next);
    } catch {}
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "cut" ? "performance" : "cut");
  }, [mode, setMode]);

  return createElement(AppModeContext.Provider, { value: { mode, setMode, toggleMode } }, children);
}

export function useAppMode() {
  return useContext(AppModeContext);
}
