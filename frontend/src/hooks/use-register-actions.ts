import { useEffect } from "react";
import { usePalette, type PaletteAction } from "../components/command-palette/context";

export function useRegisterActions(id: string, actions: PaletteAction[], deps: unknown[] = []) {
  const { registerActions, unregisterActions } = usePalette();

  useEffect(() => {
    registerActions(id, actions);
    return () => unregisterActions(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ...deps]);
}
