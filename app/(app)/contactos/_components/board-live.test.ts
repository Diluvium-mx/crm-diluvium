import { describe, expect, it } from "vitest";
import { applyTemperatures, mergeLiveContacts } from "./board-live";

type C = { id: string; stage: string; stageChangedAt: Date; temperature?: string | null };

const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 16, minute));
const c = (id: string, stage: string, minute: number, temperature: string | null = null): C => ({
  id,
  stage,
  stageChangedAt: at(minute),
  temperature,
});

// Lista como la devuelve listContacts: stageChangedAt de más nuevo a más viejo.
const board = [c("a", "prospecto", 50), c("b", "interesado", 40), c("x", "prospecto", 30), c("d", "inbox", 20)];
const column = (list: C[], stage: string) => list.filter((k) => k.stage === stage).map((k) => k.id);

describe("mergeLiveContacts", () => {
  it("un cambio de etapa sube la tarjeta arriba de su nueva columna", () => {
    const next = mergeLiveContacts(board, [c("x", "interesado", 55)]);
    expect(column(next, "interesado")).toEqual(["x", "b"]);
    expect(column(next, "prospecto")).toEqual(["a"]);
    expect(next.map((k) => k.id)).toEqual(["x", "a", "b", "d"]);
  });

  it("temperatura sin cambio de etapa: mismo lugar, solo cambia el dato", () => {
    const next = mergeLiveContacts(board, [c("x", "prospecto", 30, "caliente")]);
    expect(next.map((k) => k.id)).toEqual(["a", "b", "x", "d"]);
    expect(next[2].temperature).toBe("caliente");
  });

  it("varios en el mismo lote quedan por hora (el más reciente arriba)", () => {
    const next = mergeLiveContacts(board, [c("d", "interesado", 57), c("x", "interesado", 56)]);
    expect(column(next, "interesado")).toEqual(["d", "x", "b"]);
  });

  it("una tarjeta movida a mano (optimista, hora local) no brinca debajo de un cambio más viejo", () => {
    const local = [c("x", "compra", 60), ...board.filter((k) => k.id !== "x")];
    // El agente movió "b" ANTES de que el vendedor soltara "x".
    const next = mergeLiveContacts(local, [c("b", "compra", 58)]);
    expect(column(next, "compra")).toEqual(["x", "b"]);
  });

  it("un contacto que el tablero no tenía entra en su lugar", () => {
    const next = mergeLiveContacts(board, [c("n", "inbox", 45)]);
    expect(next.map((k) => k.id)).toEqual(["a", "n", "b", "x", "d"]);
  });

  it("sin cambios devuelve la misma lista", () => {
    expect(mergeLiveContacts(board, [])).toBe(board);
  });
});

describe("applyTemperatures", () => {
  const list = [
    { id: "a", temperature: "caliente" as string | null },
    { id: "b", temperature: null as string | null },
    { id: "x", temperature: "frio" as string | null },
  ];

  it("pone al día solo las distintas, sin reordenar; sin par = sin temperatura", () => {
    const next = applyTemperatures(list, [["a", "caliente"], ["b", "destacado"]], new Set());
    expect(next.map((c) => [c.id, c.temperature])).toEqual([
      ["a", "caliente"],
      ["b", "destacado"],
      ["x", null],
    ]);
    expect(next[0]).toBe(list[0]);
  });

  it("no toca las que están en escritura o en arrastre", () => {
    const next = applyTemperatures(list, [], new Set(["a", "x"]));
    expect(next).toBe(list);
  });
});
