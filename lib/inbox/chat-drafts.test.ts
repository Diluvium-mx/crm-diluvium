import { describe, expect, it } from "vitest";
import { DRAFT_PREFIX, DRAFT_TTL_MS, draftKey, memoryDraftStore, purgeDrafts, readDraft, writeDraft } from "./chat-drafts";

const NOW = Date.UTC(2026, 9, 29, 18, 0);

describe("borradores del chat (guardados en el navegador)", () => {
  it("lo escrito vuelve en el mismo chat, tal cual (saltos de línea incluidos)", () => {
    const store = memoryDraftStore();
    writeDraft(store, "u1", "c1", "Hola buenas tardes\n\nLo podemos contactar vía telefónica?", NOW);
    expect(readDraft(store, "u1", "c1", NOW + 60_000)).toBe("Hola buenas tardes\n\nLo podemos contactar vía telefónica?");
  });

  it("cada chat y cada usuario tiene el suyo", () => {
    const store = memoryDraftStore();
    writeDraft(store, "u1", "c1", "para Roberto", NOW);
    expect(readDraft(store, "u1", "c2", NOW)).toBeNull();
    expect(readDraft(store, "u2", "c1", NOW)).toBeNull();
  });

  it("vaciar la caja (o dejar solo espacios) borra el borrador", () => {
    const store = memoryDraftStore();
    writeDraft(store, "u1", "c1", "Hola", NOW);
    writeDraft(store, "u1", "c1", "  \n ", NOW);
    expect(readDraft(store, "u1", "c1", NOW)).toBeNull();
    expect(store.length).toBe(0);
  });

  it("vence a los 7 días sin tocarlo; escribir otra vez reinicia la cuenta", () => {
    const store = memoryDraftStore();
    writeDraft(store, "u1", "c1", "Hola", NOW);
    expect(readDraft(store, "u1", "c1", NOW + DRAFT_TTL_MS)).toBe("Hola");
    expect(readDraft(store, "u1", "c1", NOW + DRAFT_TTL_MS + 1)).toBeNull();
    writeDraft(store, "u1", "c1", "Hola de nuevo", NOW + DRAFT_TTL_MS);
    expect(readDraft(store, "u1", "c1", NOW + DRAFT_TTL_MS + 1)).toBe("Hola de nuevo");
  });

  it("un valor dañado no truena: se toma como sin borrador", () => {
    const store = memoryDraftStore();
    store.setItem(draftKey("u1", "c1"), "{no es json");
    expect(readDraft(store, "u1", "c1", NOW)).toBeNull();
    store.setItem(draftKey("u1", "c1"), JSON.stringify({ t: 5, at: NOW }));
    expect(readDraft(store, "u1", "c1", NOW)).toBeNull();
  });

  it("la limpieza quita los vencidos y dañados y deja lo demás del navegador", () => {
    const store = memoryDraftStore();
    writeDraft(store, "u1", "viejo", "Hola", NOW - DRAFT_TTL_MS - 1);
    writeDraft(store, "u1", "nuevo", "Hola", NOW);
    store.setItem(`${DRAFT_PREFIX}u1.roto`, "x");
    store.setItem("diluvium.ui.lista", "1");
    purgeDrafts(store, NOW);
    expect(readDraft(store, "u1", "nuevo", NOW)).toBe("Hola");
    expect(store.getItem(draftKey("u1", "viejo"))).toBeNull();
    expect(store.getItem(`${DRAFT_PREFIX}u1.roto`)).toBeNull();
    expect(store.getItem("diluvium.ui.lista")).toBe("1");
  });

  it("al cerrar sesión se borran todos los borradores (y solo ellos)", () => {
    const store = memoryDraftStore();
    writeDraft(store, "u1", "c1", "Hola", NOW);
    writeDraft(store, "u2", "c2", "Qué tal", NOW);
    store.setItem("diluvium.ui.lista", "0");
    purgeDrafts(store, NOW, true);
    expect(store.length).toBe(1);
    expect(store.getItem("diluvium.ui.lista")).toBe("0");
  });
});
