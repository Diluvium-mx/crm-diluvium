"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { applyThemeNow, switchThemeWithCircle, type ThemeName } from "./theme-circle-transition";
import { playThemeEgg, stopThemeEgg } from "./theme-toggle-eggs";

// Interruptor de tema de la barra de arriba (1-oct-2026, prototipo aprobado por el dueño en
// notas/barra-superior): píldora con la bolita del sol o la luna; en claro flotan 3 nubes y en
// oscuro titilan 5 estrellas (solo se ve lo del tema elegido). Al tocarlo, el tema nuevo se
// extiende en círculo desde el botón; clic derecho = broma escondida (theme-toggle-eggs.ts).
// Todo lo visual sale de la clase .dark del <html> (next-themes la fija antes del primer paint;
// app/globals.css › "Interruptor de tema"), así que no hay nada que hidratar mal: solo
// aria-checked espera a montar (en el servidor no se sabe el tema).
const CLOUDS = ["c1", "c2", "c3"];
const STARS = [
  { key: "s1", spark: true },
  { key: "s2", spark: false },
  { key: "s3", spark: false },
  { key: "s4", spark: true },
  { key: "s5", spark: false },
];

const subscribeNothing = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const dark = resolvedTheme === "dark";

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const next: ThemeName = dark ? "light" : "dark";
    stopThemeEgg();
    switchThemeWithCircle(event.currentTarget, () => {
      applyThemeNow(next);
      setTheme(next);
    });
  }

  function surprise(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    playThemeEgg(event.currentTarget);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={mounted ? dark : undefined}
      aria-label="Tema oscuro"
      title="Cambiar entre tema claro y oscuro"
      onClick={toggle}
      onContextMenu={surprise}
      className="theme-pill"
    >
      {CLOUDS.map((key) => (
        <span key={key} aria-hidden="true" className={`theme-pill-cloud ${key}`}>
          <span />
        </span>
      ))}
      {STARS.map(({ key, spark }) => (
        <span key={key} aria-hidden="true" className={`theme-pill-star ${key}`}>
          <span className={spark ? "spark" : undefined} />
        </span>
      ))}
      <span aria-hidden="true" className="theme-pill-knob">
        <Sun className="theme-pill-sun" />
        <Moon className="theme-pill-moon" />
      </span>
    </button>
  );
}
