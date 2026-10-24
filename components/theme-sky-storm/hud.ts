// Capas de pantalla de la tormenta (estilos en app/globals.css › «Tormenta del interruptor de tema»):
// el oscurecido y el destello de los relámpagos debajo del lienzo; encima, el globo de la persona, la
// indicación de amasar, la zona de clic de la casa, el tablero (tiempo, agua y presión), «Salir», el
// fundido de los cortes y la tarjeta final.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

// Lo que va DEBAJO del lienzo de WebGL.
export function createShell() {
  const root = document.createElement("div");
  root.className = "theme-storm-root";
  document.body.appendChild(root);
  const dim = el("div", "theme-storm-dim", root);
  const flash = el("div", "theme-storm-flash", root);
  return { root, dim, flash };
}

// Lo que va ENCIMA del lienzo.
export function createHud(root: HTMLElement, onExit: () => void) {
  const ui = el("div", "theme-storm-ui", root);
  const fade = el("div", "theme-storm-fade", root);
  const bubble = el("div", "theme-storm-bubble", ui);
  const tip = el("div", "theme-storm-tip", ui);
  el("b", "", tip, "👆");
  tip.append("Amasa moviendo el mouse de un lado a otro");
  const hit = el("div", "theme-storm-hit", ui);
  hit.style.display = "none";

  const hud = el("div", "theme-storm-hud", ui);
  const time = el("span", "", el("div", "theme-storm-card theme-storm-time", hud), "0:00");
  const meterCard = el("div", "theme-storm-card theme-storm-meter", hud);
  el("b", "", meterCard, "Agua dentro de la casa");
  const meterBar = el("i", "", el("div", "theme-storm-bar", meterCard));
  const pressCard = el("div", "theme-storm-card theme-storm-meter theme-storm-press", hud);
  el("b", "", pressCard, "Presión");
  const pressBar = el("i", "", el("div", "theme-storm-bar", pressCard));

  const exitBtn = el("button", "theme-storm-exit", ui, "✕ Salir");
  exitBtn.type = "button";
  exitBtn.addEventListener("click", onExit);

  let card: HTMLDivElement | null = null;

  return {
    ui,
    fade,
    bubble,
    tip,
    hit,
    setBubble(text: string) {
      if (text) bubble.textContent = text;
      bubble.classList.toggle("show", !!text);
    },
    showTip(on: boolean) {
      tip.classList.toggle("show", on);
    },
    // Tablero y «Salir» (mientras se juega).
    showBoard(on: boolean) {
      hud.classList.toggle("show", on);
      exitBtn.classList.toggle("show", on);
    },
    showPress(on: boolean) {
      pressCard.classList.toggle("on", on);
    },
    setTime(sec: number) {
      time.textContent = clock(sec);
    },
    setMeter(v: number) {
      meterBar.style.width = `${Math.min(100, v * 100)}%`;
    },
    setPress(v: number) {
      pressBar.style.width = `${Math.round(v * 100)}%`;
    },
    showCard(title: string, lines: string[], again: string, onAgain: () => void, onOut: () => void) {
      card?.remove();
      const c = el("div", "theme-storm-result", ui);
      el("h3", "", c, title);
      const p = el("p", "", c);
      lines.forEach((line, i) => {
        if (i) p.append(document.createElement("br"));
        p.append(line);
      });
      const go = el("button", "go", c, again);
      go.type = "button";
      const out = el("button", "out", c, "Salir");
      out.type = "button";
      go.addEventListener("click", () => {
        c.remove();
        onAgain();
      });
      out.addEventListener("click", () => {
        c.remove();
        onOut();
      });
      card = c;
    },
    closeCard() {
      card?.remove();
      card = null;
    },
  };
}

export function clock(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type Hud = ReturnType<typeof createHud>;
