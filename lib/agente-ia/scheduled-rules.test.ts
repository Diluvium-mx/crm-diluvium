import { describe, expect, it } from "vitest";
import { addFaq, applyAtFor, describeFaqChanges, editFaq, faqChanges, isNight, removeFaqs, sameFaqs, type FaqItem } from "./scheduled-rules";

// Mazatlán = UTC−7 todo el año.
const mzt = (local: string) => new Date(`${local}:00-07:00`);

describe("cuándo se aplica lo programado", () => {
  it("de día: hoy a las 22:00 (Mazatlán)", () => {
    expect(applyAtFor(mzt("2026-10-09T10:15")).toISOString()).toBe(mzt("2026-10-09T22:00").toISOString());
    expect(applyAtFor(mzt("2026-10-09T21:59")).toISOString()).toBe(mzt("2026-10-09T22:00").toISOString());
    expect(applyAtFor(mzt("2026-10-09T06:00")).toISOString()).toBe(mzt("2026-10-09T22:00").toISOString());
  });

  it("de 22:00 a 6:00 es de noche: de inmediato", () => {
    for (const at of ["2026-10-09T22:00", "2026-10-09T23:30", "2026-10-10T02:00", "2026-10-10T05:59"]) {
      expect(isNight(mzt(at))).toBe(true);
      expect(applyAtFor(mzt(at)).getTime()).toBe(mzt(at).getTime());
    }
    expect(isNight(mzt("2026-10-09T12:00"))).toBe(false);
  });
});

describe("lista de FAQs programada", () => {
  const base: FaqItem[] = [
    { id: "a", question: "¿Precio?", answer: "$5,500", enabled: true, position: 1 },
    { id: "b", question: "¿Dónde?", answer: "Los Mochis", enabled: true, position: 2 },
  ];

  it("agregar, editar y borrar sin tocar la lista original", () => {
    const added = addFaq(base, { question: " ¿Garantía? ", answer: "1 año", enabled: false }, "c");
    expect(added.map((f) => [f.id, f.position, f.question])).toEqual([
      ["a", 1, "¿Precio?"],
      ["b", 2, "¿Dónde?"],
      ["c", 3, "¿Garantía?"],
    ]);
    const edited = editFaq(added, "a", { question: "¿Precio?", answer: "$5,000", enabled: true });
    expect(edited[0].answer).toBe("$5,000");
    const removed = removeFaqs(edited, ["b"]);
    expect(removed.map((f) => [f.id, f.position])).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
    expect(base[0].answer).toBe("$5,500");
  });

  it("misma lista = mismo contenido y orden, aunque cambien los ids", () => {
    expect(sameFaqs(base, base.map((f) => ({ ...f, id: `${f.id}2` })))).toBe(true);
    expect(sameFaqs(base, [...base].reverse().map((f, i) => ({ ...f, position: i + 1 })))).toBe(false);
    expect(sameFaqs(base, editFaq(base, "a", { question: "¿Precio?", answer: "$5,500", enabled: false }))).toBe(false);
  });

  it("resumen del aviso: nuevas, editadas y borradas", () => {
    const next = removeFaqs(addFaq(editFaq(base, "a", { question: "¿Precio?", answer: "$5,000", enabled: true }), { question: "¿X?", answer: "Y", enabled: true }, "c"), ["b"]);
    expect(faqChanges(base, next)).toEqual({ nuevas: 1, editadas: 1, borradas: 1 });
    expect(describeFaqChanges(faqChanges(base, next))).toBe("1 nueva, 1 editada, 1 borrada");
    expect(describeFaqChanges({ nuevas: 2, editadas: 0, borradas: 3 })).toBe("2 nuevas, 3 borradas");
  });
});
