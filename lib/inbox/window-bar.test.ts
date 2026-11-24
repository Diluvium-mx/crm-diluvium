import { describe, expect, it } from "vitest";
import { COSTO_MSJ, COSTO_PLANTILLA, fechaBarra, pesos, tiempoQueQueda, windowBar, type WindowBarInput } from "./window-bar";

const H = 3_600_000;
const now = new Date("2026-11-20T19:00:00Z"); // vie 20, 12:00 p.m. en Mazatlán
const at = (ms: number) => new Date(now.getTime() + ms);

const base = (over: Partial<WindowBarInput> = {}): WindowBarInput => ({
  channelType: "whatsapp",
  windowExpiresAt: at(21 * H),
  simulado: false,
  archivado: false,
  adEntry: null,
  servicioGratis: null,
  now,
  ...over,
});

describe("tiempoQueQueda", () => {
  it("horas hacia arriba desde 2 h; minutos abajo de 2 h", () => {
    expect(tiempoQueQueda(20.2 * H)).toBe("21 h");
    expect(tiempoQueQueda(2 * H)).toBe("2 h");
    expect(tiempoQueQueda(80 * 60_000)).toBe("1 h 20 min");
    expect(tiempoQueQueda(60 * 60_000)).toBe("1 h");
    expect(tiempoQueQueda(44.2 * 60_000)).toBe("45 min");
    expect(tiempoQueQueda(10_000)).toBe("1 min");
  });
});

describe("precios en pesos", () => {
  it("mensaje $0.21, plantilla de venta $0.76 (dólar del DOF de noviembre, 18.73)", () => {
    expect(COSTO_MSJ).toBe("$0.21");
    expect(COSTO_PLANTILLA).toBe("$0.76");
    expect(pesos(0.008406)).toBe("$0.16");
  });
});

describe("windowBar · WhatsApp", () => {
  it("B1 ventana normal sin gratis del mes: Costo de msj y lo disponible, azul", () => {
    const bar = windowBar(base());
    expect(bar).toMatchObject({ tone: "costo", icon: "coin", strong: "Costo de msj: $0.21", rest: "· 21 h disponible" });
    expect(bar.title).toContain("$0.76 la de venta, $0.16 la de utilidad");
    expect(bar.title).toContain("WAB = la app de WhatsApp Business");
  });

  it("ventana normal con gratis del mes: Gratis y cuántos quedan (redondeado a 10)", () => {
    const bar = windowBar(base({ servicioGratis: { quedan: 647, hasta: at(3 * H) } }));
    expect(bar).toMatchObject({ tone: "gratis", strong: "Gratis", rest: "· 21 h disponible · 640 de 1,000" });
  });

  it("con menos de 50 gratis del mes ya dice Costo de msj (Meta reporta con atraso)", () => {
    expect(windowBar(base({ servicioGratis: { quedan: 49, hasta: at(3 * H) } })).strong).toBe("Costo de msj: $0.21");
    expect(windowBar(base({ servicioGratis: { quedan: 50, hasta: at(3 * H) } })).strong).toBe("Gratis");
  });

  it("los gratis del mes dejan de valer cuando vence el dato (chat abierto horas)", () => {
    expect(windowBar(base({ servicioGratis: { quedan: 600, hasta: at(-1) } })).strong).toBe("Costo de msj: $0.21");
  });

  it("el title de los gratis del mes avisa que las plantillas sí se cobran", () => {
    expect(windowBar(base({ servicioGratis: { quedan: 600, hasta: at(H) } })).title).toContain("Las plantillas sí se cobran");
  });

  it("B6 poco tiempo (< 2 h): lo disponible, el costo del mensaje y el de la plantilla después", () => {
    const bar = windowBar(base({ windowExpiresAt: at(45 * 60_000) }));
    expect(bar).toMatchObject({ tone: "aviso", icon: "clock", strong: "45 min disponible", rest: "· Costo de msj: $0.21 · después plantilla: $0.76" });
    expect(bar.title).toContain("$0.76 la de venta");
    expect(windowBar(base({ windowExpiresAt: at(2 * H) })).strong).toBe("Costo de msj: $0.21");
    expect(windowBar(base({ windowExpiresAt: at(45 * 60_000), servicioGratis: { quedan: 300, hasta: at(H) } }))).toMatchObject({
      strong: "Gratis",
      rest: "· 45 min disponible · 300 de 1,000 · después plantilla: $0.76",
    });
  });

  it("B7 ventana cerrada: Solo plantilla = $0.76 · gratis en WAB", () => {
    const bar = windowBar(base({ windowExpiresAt: at(-3 * H) }));
    expect(bar).toMatchObject({ tone: "aviso", icon: "template", strong: "Solo plantilla = $0.76", rest: "· gratis en WAB" });
    expect(bar.title).toContain("Pasaron 24 h");
  });

  it("el cliente todavía no escribe: solo plantilla y lo dice", () => {
    const bar = windowBar(base({ windowExpiresAt: null }));
    expect(bar).toMatchObject({ strong: "Solo plantilla = $0.76", rest: "· espera mensaje o gratis en WAB" });
  });

  it("anuncio con tiempo gratis (regla de 72 h): Gratis por anuncio hasta…", () => {
    const firstReplyAt = at(-10 * H);
    const bar = windowBar(base({ windowExpiresAt: at(80 * H), adEntry: { entryAt: at(-11 * H), firstReplyAt, metaFreeUntil: null } }));
    const until = new Date(firstReplyAt.getTime() + 72 * H);
    expect(bar).toMatchObject({ tone: "gratis", icon: "gift", strong: "Gratis", rest: `por anuncio hasta ${fechaBarra(until)}` });
  });

  it("anuncio: si la ventana de 24 h cierra antes que lo gratis, también dice cuánto queda para escribir", () => {
    const firstReplyAt = at(-10 * H);
    const bar = windowBar(base({ windowExpiresAt: at(5 * H), adEntry: { entryAt: at(-11 * H), firstReplyAt, metaFreeUntil: null } }));
    expect(bar.rest).toBe(`por anuncio hasta ${fechaBarra(new Date(firstReplyAt.getTime() + 72 * H))}`);
    expect(bar.title).toContain(`El texto libre se puede hasta ${fechaBarra(at(5 * H))}`);
  });

  it("anuncio: la marca de Meta manda (puede pasar de 72 h)", () => {
    const metaFreeUntil = at(100 * H);
    const bar = windowBar(base({ adEntry: { entryAt: at(-90 * H), firstReplyAt: at(-89 * H), metaFreeUntil } }));
    expect(bar.rest).toContain(`por anuncio hasta ${fechaBarra(metaFreeUntil)}`);
  });

  it("anuncio: si la marca de Meta de esta entrada ya venció, ya no es gratis (no vuelve a las 72 h)", () => {
    const bar = windowBar(base({ adEntry: { entryAt: at(-50 * H), firstReplyAt: at(-49 * H), metaFreeUntil: at(-1 * H) } }));
    expect(bar.strong).toBe("Costo de msj: $0.21");
  });

  it("número archivado: no se puede escribir, aunque la ventana siga abierta", () => {
    expect(windowBar(base({ archivado: true }))).toMatchObject({ tone: "cerrado", icon: "archive", strong: "No se puede escribir,", rest: "este número ya no está conectado" });
    expect(windowBar(base({ archivado: true, windowExpiresAt: at(-3 * H) })).strong).toBe("No se puede escribir,");
  });

  it("anuncio con la ventana cerrada: Plantilla gratis hasta…", () => {
    const firstReplyAt = at(-30 * H);
    const bar = windowBar(base({ windowExpiresAt: at(-2 * H), adEntry: { entryAt: at(-31 * H), firstReplyAt, metaFreeUntil: null } }));
    expect(bar).toMatchObject({
      tone: "gratis",
      strong: "Plantilla gratis",
      rest: `hasta ${fechaBarra(new Date(firstReplyAt.getTime() + 72 * H))} · Costo de plantilla: $0.76`,
    });
  });

  it("anuncio sin contestar: Contesta antes de… y todo es gratis por 72 h", () => {
    const entryAt = at(-3 * H);
    const bar = windowBar(base({ adEntry: { entryAt, firstReplyAt: null, metaFreeUntil: null } }));
    expect(bar).toMatchObject({
      tone: "aviso",
      icon: "gift",
      strong: "Gratis",
      rest: `hasta ${fechaBarra(new Date(entryAt.getTime() + 24 * H))}`,
    });
  });

  it("anuncio ya vencido: vuelve a las reglas de siempre", () => {
    const bar = windowBar(base({ adEntry: { entryAt: at(-100 * H), firstReplyAt: at(-99 * H), metaFreeUntil: null } }));
    expect(bar.strong).toBe("Costo de msj: $0.21");
  });

  it("anuncio que no se contestó a tiempo: sin gratis", () => {
    const bar = windowBar(base({ adEntry: { entryAt: at(-30 * H), firstReplyAt: at(-5 * H), metaFreeUntil: null } }));
    expect(bar.strong).toBe("Costo de msj: $0.21");
  });

  it("cliente de prueba: no cuesta y la ventana nunca cierra", () => {
    expect(windowBar(base({ simulado: true }))).toMatchObject({ tone: "gratis", icon: "test", strong: "Cliente de prueba" });
  });
});

describe("windowBar · Instagram", () => {
  const ig = (over: Partial<WindowBarInput> = {}) => windowBar(base({ channelType: "instagram", ...over }));

  it("dentro de 24 h: Gratis, cualquiera puede escribir", () => {
    expect(ig()).toMatchObject({ tone: "gratis", icon: "instagram", strong: "Gratis", rest: `hasta ${fechaBarra(at(21 * H))}` });
  });

  it("de 24 h a 7 días: Gratis, solo un vendedor, hasta…", () => {
    const windowExpiresAt = at(-5 * H);
    const hasta = new Date(windowExpiresAt.getTime() - 24 * H + 7 * 24 * H);
    expect(ig({ windowExpiresAt })).toMatchObject({ tone: "gratis", strong: "Gratis", rest: `hasta ${fechaBarra(hasta)}` });
  });

  it("después de 7 días: no se puede escribir (gris)", () => {
    expect(ig({ windowExpiresAt: at(-7 * 24 * H) })).toMatchObject({ tone: "cerrado", strong: "No se puede escribir", rest: "hasta que cliente responda" });
    expect(ig({ windowExpiresAt: null }).rest).toBe("hasta que cliente responda");
  });

  it("los gratis del mes y los anuncios no aplican a Instagram", () => {
    expect(ig({ servicioGratis: { quedan: 900, hasta: at(H) }, adEntry: { entryAt: at(-1 * H), firstReplyAt: null, metaFreeUntil: null } }).rest).toBe(
      `hasta ${fechaBarra(at(21 * H))}`,
    );
  });
});
