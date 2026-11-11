import { describe, expect, it } from "vitest";
import type { ResenaFila } from "./queries";
import { pasoDe, resenaVista } from "./vista";

const NOW = new Date("2026-11-06T16:00:00Z"); // 9:00 en Mazatlán
const DIA = 24 * 60 * 60 * 1000;

// De Mercado Libre, con más de 40 días desde que lo dijo (ya pasó Compra Protegida).
function fila(over: Partial<ResenaFila> = {}): ResenaFila {
  return {
    id: "r1",
    contactId: "c1",
    conversationId: "conv1",
    tienda: "mercado_libre",
    frase: "Ya la encargué en Mercado Libre, gracias",
    estado: "por_pedir",
    trato: "sra",
    createdAt: new Date("2026-09-20T15:45:00Z"),
    pedidaAt: null,
    contacto: "Leticia Pérez",
    nombre: "Leticia",
    telefono: "+526691110000",
    ...over,
  };
}

describe("Mercado Libre: se le escribe pasada Compra Protegida", () => {
  it("antes de 40 días: en espera, con la fecha y sin mensajes", () => {
    const v = resenaVista(fila({ createdAt: new Date("2026-10-03T15:37:00Z") }), NOW, "Carlos");
    expect(v).toMatchObject({ seccion: "espera", marca: null, mensajes: null, whatsappHref: null });
    expect(v.aviso).toBe("Se le puede escribir desde el 12-nov-2026: antes, Mercado Libre no lo permite (Compra Protegida).");
  });

  it("ya se puede: por solicitar, con sus mensajes, WhatsApp Web y «Ya le escribí»", () => {
    const v = resenaVista(fila(), NOW, "Carlos");
    expect(v).toMatchObject({ titulo: "Leticia Pérez", tienda: "Mercado Libre", seccion: "pedir", marca: "escribi", dicho: "Lo dijo el 20-sep-2026", chatHref: "/dashboard?contacto=c1" });
    expect(v.mensajes?.saludo).toBe("Hola, buenos días, Sra. Leticia. Le habla Carlos, de Diluvium 😃");
    expect(v.whatsappHref).toMatch(/^https:\/\/web\.whatsapp\.com\/send\?phone=526691110000&text=Hola/);
  });

  it("sin teléfono: mensajes sí, enlace no, y lo dice", () => {
    const v = resenaVista(fila({ telefono: null }), NOW, "Carlos");
    expect(v.mensajes).not.toBeNull();
    expect(v.whatsappHref).toBeNull();
    expect(v.aviso).toContain("No tiene teléfono");
  });
});

describe("Amazon: por WhatsApp desde el primer día", () => {
  it("por solicitar desde que lo dijo, sin plazo de Seller Central", () => {
    for (const createdAt of [new Date(NOW.getTime() - DIA), new Date(NOW.getTime() - 60 * DIA)]) {
      expect(pasoDe(fila({ tienda: "amazon", createdAt }), NOW)).toMatchObject({ seccion: "pedir", marca: "escribi" });
    }
  });

  it("las que ya se solicitaron en Seller Central no se vuelven a pedir ni se deshacen", () => {
    const v = resenaVista(fila({ tienda: "amazon", estado: "pedida", pedidaAt: new Date("2026-10-27T23:37:00Z") }), NOW, "Carlos");
    expect(v).toMatchObject({ seccion: "pedida", marca: null, mensajes: null, aviso: "Se solicitó en Seller Central el 27-oct-2026 16:37: Amazon no deja volver a pedirla." });
  });
});

describe("Solicitadas", () => {
  it("dice cuándo le escribió, guarda sus mensajes para cuando conteste y tiene «Deshacer»", () => {
    for (const tienda of ["amazon", "mercado_libre"] as const) {
      const v = resenaVista(fila({ tienda, estado: "pedida", pedidaAt: new Date("2026-11-06T17:30:00Z") }), NOW, "Carlos");
      expect(v).toMatchObject({ seccion: "pedida", marca: "deshacer", aviso: "Le escribiste el 6-nov-2026 10:30. Cuando conteste, usa la respuesta que va." });
      expect(v.mensajes?.bien).toContain("¿me haría un favor?");
    }
  });

  it("orden: por solicitar el más antiguo primero; solicitadas la más reciente primero", () => {
    const vieja = pasoDe(fila({ createdAt: new Date("2026-09-01T00:00:00Z") }), NOW);
    const nueva = pasoDe(fila({ createdAt: new Date("2026-09-20T00:00:00Z") }), NOW);
    expect(vieja.orden).toBeLessThan(nueva.orden);
    const antes = pasoDe(fila({ estado: "pedida", pedidaAt: new Date("2026-11-06T10:00:00Z") }), NOW);
    const despues = pasoDe(fila({ estado: "pedida", pedidaAt: new Date("2026-11-06T12:00:00Z") }), NOW);
    expect(despues.orden).toBeLessThan(antes.orden);
  });
});
