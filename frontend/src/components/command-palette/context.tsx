import { createContext, useCallback, useContext, useRef, useState } from "react";

export interface PaletteAction {
  id: string;
  label: string;
  group?: string;
  keywords?: string[];
  onSelect: () => void;
}

interface PaletteContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  registerActions: (id: string, actions: PaletteAction[]) => void;
  unregisterActions: (id: string) => void;
  getAllActions: () => PaletteAction[];
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const registry = useRef<Map<string, PaletteAction[]>>(new Map());

  const registerActions = useCallback((id: string, actions: PaletteAction[]) => {
    registry.current.set(id, actions);
  }, []);

  const unregisterActions = useCallback((id: string) => {
    registry.current.delete(id);
  }, []);

  const getAllActions = useCallback((): PaletteAction[] => {
    return Array.from(registry.current.values()).flat();
  }, []);

  return (
    <PaletteContext.Provider value={{ open, setOpen, registerActions, unregisterActions, getAllActions }}>
      {children}
    </PaletteContext.Provider>
  );
}

export function usePalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette used outside PaletteProvider");
  return ctx;
}
