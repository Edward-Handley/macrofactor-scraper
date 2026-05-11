import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/use-theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-800 transition-colors"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
