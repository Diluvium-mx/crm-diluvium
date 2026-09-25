import { describe, expect, it } from "vitest";
import { isForward, isStage, STAGES } from "./stages";

describe("etapas: solo hacia adelante", () => {
  it("orden Inbox → Prospecto → Interesado → Cerca de compra → Compra", () => {
    expect(STAGES).toEqual(["inbox", "prospecto", "interesado", "cerca_compra", "compra"]);
    expect(isForward("inbox", "prospecto")).toBe(true);
    expect(isForward("interesado", "compra")).toBe(true);
    expect(isForward("compra", "cerca_compra")).toBe(false);
    expect(isForward("interesado", "interesado")).toBe(false);
    expect(isStage("compra")).toBe(true);
    expect(isStage("ganado")).toBe(false);
  });
});
