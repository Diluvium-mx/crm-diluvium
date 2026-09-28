import { describe, expect, it } from "vitest";
import { isForeignTemplateAccount, templateKey, templateSyncLines, templatesToRemove } from "./template-sync";

const row = (id: string, name: string, language: string, status: string) => ({ id, name, language, status });

describe("templatesToRemove", () => {
  it("marca las locales que ya NO vienen del proveedor (Meta las eliminó)", () => {
    const existing = [
      row("a", "order_confirmation", "es_MX", "APPROVED"),
      row("b", "promo_lluvias", "es_MX", "APPROVED"),
    ];
    const remote = [{ name: "order_confirmation", language: "es_MX" }];
    expect(templatesToRemove(existing, remote)).toEqual(["b"]);
  });

  it("distingue por idioma: misma name, distinto language, es otra plantilla", () => {
    const existing = [row("a", "bienvenida", "es_MX", "APPROVED"), row("b", "bienvenida", "en_US", "APPROVED")];
    const remote = [{ name: "bienvenida", language: "es_MX" }];
    expect(templatesToRemove(existing, remote)).toEqual(["b"]);
  });

  it("no re-marca las que ya estaban REMOVED", () => {
    const existing = [row("a", "vieja", "es_MX", "REMOVED")];
    expect(templatesToRemove(existing, [])).toEqual([]);
  });

  it("si todo sigue presente, no remueve nada", () => {
    const existing = [row("a", "x", "es", "APPROVED")];
    expect(templatesToRemove(existing, [{ name: "x", language: "es" }])).toEqual([]);
  });

  it("un remoto vacío (lectura completa) marca todo lo no-removido", () => {
    const existing = [row("a", "x", "es", "APPROVED"), row("b", "y", "es", "PENDING")];
    expect(templatesToRemove(existing, [])).toEqual(["a", "b"]);
  });
});

describe("isForeignTemplateAccount", () => {
  it("el sandbox compartido de Zernio no es de Diluvium (con o sin espacios)", () => {
    expect(isForeignTemplateAccount("6a180a034c7f364ffded3c9c")).toBe(true);
    expect(isForeignTemplateAccount(" 6a180a034c7f364ffded3c9c ")).toBe(true);
  });

  it("cualquier otra cuenta (la de Diluvium, pruebas) sí es propia", () => {
    expect(isForeignTemplateAccount("acc_diluvium")).toBe(false);
    expect(isForeignTemplateAccount("")).toBe(false);
  });
});

describe("templateKey", () => {
  it("combina name y language sin colisiones por concatenación ingenua", () => {
    expect(templateKey("a", "bc")).not.toBe(templateKey("ab", "c"));
  });
});

describe("templateSyncLines (Historial, Bloque E)", () => {
  const t = (name: string, status: string, body: string | null) => ({ name, language: "es_MX", status, body });
  it("nueva, cambio de estado, cambio de texto y quitada en Meta; lo igual no sale", () => {
    const previous = [t("bienvenida", "PENDING", "Hola {{1}}"), t("promo", "APPROVED", "Promo"), t("igual", "APPROVED", "Igual"), t("vieja", "APPROVED", "Vieja")];
    const remote = [t("bienvenida", "APPROVED", "Hola {{1}}"), t("promo", "APPROVED", "Promo de lluvias"), t("igual", "APPROVED", "Igual"), t("nueva", "PENDING", "Nueva")];
    expect(templateSyncLines(previous, remote, [{ name: "vieja", language: "es_MX", status: "APPROVED" }])).toEqual([
      { title: "bienvenida (es_MX) · estado", before: "En revisión", after: "Aprobada" },
      { title: "promo (es_MX) · texto", before: "Promo", after: "Promo de lluvias" },
      { title: "nueva (es_MX) · nueva", before: null, after: "En revisión: Nueva" },
      { title: "vieja (es_MX) · quitada en Meta", before: "Aprobada", after: "Eliminada en Meta" },
    ]);
  });
  it("sin cambios = sin líneas", () => {
    const same = [t("a", "APPROVED", "A")];
    expect(templateSyncLines(same, same, [])).toEqual([]);
  });
});
