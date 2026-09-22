import { describe, expect, it } from "vitest";
import { mergeItems } from "./list-merge";
import type { ConversationListItem } from "./types";

function item(id: string, at: string | null, unread = 0): ConversationListItem {
  return {
    id,
    contact: { id: `c_${id}`, name: id, firstName: id, lastName: null, phone: null, avatarInitials: "X", sourceChannel: null },
    lastMessage: at ? { preview: "hola", direction: "in", kind: "text", at: new Date(at) } : null,
    unreadCount: unread,
    isStarred: false,
    awaitingReplySince: null,
    windowExpiresAt: null,
  };
}

const list = [item("c", "2026-09-22T12:00:00Z"), item("b", "2026-09-22T11:00:00Z"), item("a", "2026-09-22T10:00:00Z")];

describe("mergeItems (tiempo real de la lista)", () => {
  it("una conversación con mensaje nuevo sube al tope sin recargar el resto", () => {
    const out = mergeItems(list, ["a"], new Map([["a", item("a", "2026-09-22T13:00:00Z", 1)]]), false);
    expect(out.map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(out[0].unreadCount).toBe(1);
  });

  it("inserta una conversación nueva en su lugar", () => {
    const out = mergeItems(list, ["n"], new Map([["n", item("n", "2026-09-22T11:30:00Z")]]), false);
    expect(out.map((c) => c.id)).toEqual(["c", "n", "b", "a"]);
  });

  it("quita la que ya no pasa el filtro (p. ej. leída con el filtro No leído)", () => {
    const out = mergeItems(list, ["b"], new Map(), false);
    expect(out.map((c) => c.id)).toEqual(["c", "a"]);
  });

  it("con más páginas sin cargar no inserta una que cae después de la última cargada", () => {
    const out = mergeItems(list, ["old"], new Map([["old", item("old", "2026-09-22T09:00:00Z")]]), true);
    expect(out.map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  it("no pierde la página cargada: solo toca las conversaciones indicadas", () => {
    const long = Array.from({ length: 120 }, (_, i) => item(`k${i}`, new Date(Date.UTC(2026, 8, 22, 12, 0, 120 - i)).toISOString()));
    const out = mergeItems(long, ["k50"], new Map([["k50", item("k50", "2026-09-22T13:00:00Z")]]), true);
    expect(out).toHaveLength(120);
    expect(out[0].id).toBe("k50");
  });
});
