// Cambio de tema con «círculo desde el botón» (1-oct-2026, prototipo aprobado por el dueño en
// notas/barra-superior): el tema nuevo nace en el interruptor y se extiende en círculo hasta
// cubrir la pantalla (0.7 s) con View Transitions. Sin soporte del navegador o con «reducir
// movimiento», el cambio es instantáneo como antes. Estilos en app/globals.css › "Interruptor de tema".

export type ThemeName = "light" | "dark";

// Pone el tema en el <html> en ese mismo instante, igual que next-themes (attribute="class" y
// color-scheme) y sin transiciones de color (disableTransitionOnChange): la View Transition toma
// la foto del tema nuevo al terminar esta función, antes de que llegue el efecto de next-themes.
export function applyThemeNow(theme: ThemeName): void {
  const root = document.documentElement;
  const pause = document.createElement("style");
  pause.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(pause);
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  window.getComputedStyle(document.body);
  window.setTimeout(() => pause.remove(), 1);
}

export function switchThemeWithCircle(origin: HTMLElement, apply: () => void): void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof document.startViewTransition !== "function") {
    apply();
    return;
  }
  const box = origin.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const root = document.documentElement;
  root.dataset.themeCircle = "";
  const transition = document.startViewTransition(apply);
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {});
  const done = () => {
    delete root.dataset.themeCircle;
  };
  transition.finished.then(done, done);
}
