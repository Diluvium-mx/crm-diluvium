"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // Renderiza ambos íconos y deja que la variante `dark:` de Tailwind muestre
  // el correcto según la clase del <html> (que next-themes fija antes del
  // primer paint). Sin useState/useEffect: nada que hidratar mal.
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Cambiar entre tema claro y oscuro"
      title="Cambiar tema"
      className="flex h-8 w-8 items-center justify-center rounded text-brand-white transition-colors hover:bg-white/10"
    >
      <Moon className="h-4 w-4 dark:hidden" />
      <Sun className="hidden h-4 w-4 dark:block" />
    </button>
  );
}
