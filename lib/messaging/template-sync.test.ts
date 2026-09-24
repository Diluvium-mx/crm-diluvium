import { describe, expect, it } from "vitest";
import { isForeignTemplateAccount, templateKey, templatesToRemove } from "./template-sync";

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
