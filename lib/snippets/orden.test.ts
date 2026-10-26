// Orden manual de los mensajes rápidos (lib/snippets/orden.ts). Sin base de datos.
import { describe, expect, it } from "vitest";
import { isFullOrder, moveItem } from "./orden";

describe("orden manual de los mensajes rápidos", () => {
  it("solo vale un orden con los mismos, sin faltar, sobrar ni repetir", () => {
    expect(isFullOrder(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
    expect(isFullOrder(["a", "b", "c"], ["a", "b"])).toBe(false);
    expect(isFullOrder(["a", "b", "c"], ["a", "b", "c", "d"])).toBe(false);
    expect(isFullOrder(["a", "b", "c"], ["a", "a", "b"])).toBe(false);
    expect(isFullOrder(["a", "b", "c"], ["a", "b", "x"])).toBe(false);
    expect(isFullOrder([], [])).toBe(true);
  });

  it("mover arriba, abajo, al principio y al final", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b", "c", "d"], 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(moveItem(["a", "b", "c", "d"], 1, 2)).toEqual(["a", "c", "b", "d"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
