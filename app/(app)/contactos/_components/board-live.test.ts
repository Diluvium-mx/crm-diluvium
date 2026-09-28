import { describe, expect, it } from "vitest";
import { applyTemperatures, boardActivityAt, columnsByStage, mergeLiveContacts } from "./board-live";

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

describe("columnsByStage (orden de cada columna)", () => {
  type S = { id: string; stage: string; stageChangedAt: Date; createdAt: Date; lastInboundAt: number | null };
  const s = (id: string, stage: string, stageMinute: number, inboundMinute: number | null = null, createdMinute = 0): S => ({
    id,
    stage,
    stageChangedAt: at(stageMinute),
    createdAt: at(createdMinute),
    lastInboundAt: inboundMinute === null ? null : at(inboundMinute).getTime(),
  });
  const ids = (map: Map<string, S[]>, stage: string) => (map.get(stage) ?? []).map((k) => k.id);
  const none = () => undefined;

  it("el que escribió al último sube arriba de su columna aunque haya entrado antes a la etapa", () => {
    const list = [s("jaime", "cerca", 50), s("rene", "cerca", 10, 55), s("adrian", "cerca", 40)];
    expect(ids(columnsByStage(list, ["cerca"], none), "cerca")).toEqual(["rene", "jaime", "adrian"]);
  });

  it("un cambio de etapa más nuevo que el último mensaje gana", () => {
    const list = [s("rene", "cerca", 10, 55), s("nuevo", "cerca", 58)];
    expect(ids(columnsByStage(list, ["cerca"], none), "cerca")).toEqual(["nuevo", "rene"]);
  });

  it("la hora en vivo (SSE) sube la tarjeta sin recargar; una hora vieja no la baja", () => {
    const list = [s("jaime", "cerca", 50), s("rene", "cerca", 10, 20)];
    const live = (id: string) => (id === "rene" ? at(59).getTime() : id === "jaime" ? at(1).getTime() : null);
    expect(ids(columnsByStage(list, ["cerca"], live), "cerca")).toEqual(["rene", "jaime"]);
  });

  it("empates: primero el contacto más nuevo y luego el id; agrupa por etapa y omite etapas desconocidas", () => {
    const list = [s("b", "inbox", 30, null, 1), s("a", "inbox", 30, null, 1), s("c", "inbox", 30, null, 5), s("z", "borrada", 59)];
    const map = columnsByStage(list, ["inbox", "compra"], none);
    expect(ids(map, "inbox")).toEqual(["c", "a", "b"]);
    expect(ids(map, "compra")).toEqual([]);
    expect(map.has("borrada")).toBe(false);
  });

  it("boardActivityAt toma lo más reciente de etapa, carga y vivo", () => {
    expect(boardActivityAt(s("x", "inbox", 10, 20), at(30).getTime())).toBe(at(30).getTime());
    expect(boardActivityAt(s("x", "inbox", 40, 20), null)).toBe(at(40).getTime());
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
