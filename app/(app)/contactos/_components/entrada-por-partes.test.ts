import { describe, expect, it } from "vitest";
import type { BoardContact } from "../_data/types";
import { agregarNuevos, anotarLlegados, faltanEnContador, textoBuscable } from "./entrada-por-partes";

function contacto(id: string, createdAt: string, extra: Partial<BoardContact> = {}): BoardContact {
  return {
    id,
    firstName: "Ana",
    lastName: null,
    phoneE164: null,
    instagramUsername: null,
    stage: "inbox",
    temperature: null,
    destacado: false,
    esPrueba: false,
    sourceChannel: null,
    createdAt: new Date(createdAt),
    stageChangedAt: new Date(createdAt),
    stageChangedBy: null,
    lastInboundAt: null,
    ...extra,
  };
}

const CARGA = new Date("2026-11-02T12:00:00Z").getTime();

describe("columna de entrada por partes", () => {
  it("un contacto que no estaba y ya existía al cargar era de los que faltaban", () => {
    const ids = new Set(["a"]);
    const n = anotarLlegados(ids, [contacto("a", "2026-10-01T00:00:00Z"), contacto("b", "2026-10-01T00:00:00Z")], CARGA);
    expect(n).toBe(1);
    expect(ids.has("b")).toBe(true);
  });

  it("uno dado de alta después de cargar no baja los que faltan", () => {
    const ids = new Set<string>();
    expect(anotarLlegados(ids, [contacto("nuevo", "2026-11-02T12:00:01Z")], CARGA)).toBe(0);
  });

  it("el mismo contacto que llega por dos caminos cuenta una vez", () => {
    const ids = new Set<string>();
    const viejo = contacto("v", "2026-09-01T00:00:00Z");
    expect(anotarLlegados(ids, [viejo], CARGA)).toBe(1);
    expect(anotarLlegados(ids, [viejo], CARGA)).toBe(0);
  });

  it("el contador suma los que faltan solo sin buscador, filtros ni «No leído»", () => {
    expect(faltanEnContador(11_000, true)).toBe(11_000);
    expect(faltanEnContador(11_000, false)).toBe(0);
    expect(faltanEnContador(-3, true)).toBe(0);
  });

  it("agrega solo los que no tenía, sin tocar los que ya estaban", () => {
    const propio = contacto("a", "2026-10-01T00:00:00Z", { stage: "prospecto" });
    const delServidor = contacto("a", "2026-10-01T00:00:00Z", { stage: "inbox" });
    const lista = agregarNuevos([propio], [delServidor, contacto("b", "2026-10-01T00:00:00Z")]);
    expect(lista.map((c) => [c.id, c.stage])).toEqual([
      ["a", "prospecto"],
      ["b", "inbox"],
    ]);
    const misma = [propio];
    expect(agregarNuevos(misma, [delServidor])).toBe(misma);
  });

  it("el texto para buscar va sin acentos ni mayúsculas y se prepara una vez", () => {
    const c = contacto("a", "2026-10-01T00:00:00Z", { firstName: "José", lastName: "Peña", instagramUsername: "Compuertas_MX" });
    const t = textoBuscable(c);
    expect(t).toEqual({ nombre: "jose pena", usuario: "compuertas_mx" });
    expect(textoBuscable(c)).toBe(t);
  });
});
