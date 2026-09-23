import { describe, expect, it } from "vitest";
import { interleaveNotices } from "./timeline";

const row = (id: string, at: string) => ({ id, sentAt: new Date(at) });
const notice = (id: string, at: string) => ({ id, createdAt: at });

describe("interleaveNotices", () => {
  it("coloca cada aviso después del último mensaje anterior a su hora", () => {
    const items = interleaveNotices(
      [row("m1", "2026-09-23T10:00:00Z"), row("m2", "2026-09-23T10:05:00Z")],
      [notice("n2", "2026-09-23T10:06:00Z"), notice("n1", "2026-09-23T10:01:00Z")],
      false,
    );
    expect(items.map((x) => (x.kind === "row" ? x.row.id : x.notice.id))).toEqual(["m1", "n1", "m2", "n2"]);
  });

  it("con mensajes viejos sin cargar, oculta los avisos anteriores al primero cargado", () => {
    const items = interleaveNotices([row("m9", "2026-09-23T10:00:00Z")], [notice("viejo", "2026-09-22T10:00:00Z")], true);
    expect(items.map((x) => x.kind)).toEqual(["row"]);
  });

  it("sin mensajes, muestra los avisos", () => {
    expect(interleaveNotices([], [notice("n", "2026-09-23T10:00:00Z")], false)).toHaveLength(1);
  });
});
