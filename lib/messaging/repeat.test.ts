import { describe, expect, it } from "vitest";
import { repeatKey, splitRepeated } from "./repeat";

describe("candado anti-repetición (pregunta duplicada, 28-sep-2026)", () => {
  it("idéntico = mismo texto sin importar mayúsculas, espacios de más ni la forma de los acentos", () => {
    expect(repeatKey("  ¿Usted tiene   problemas\nde INUNDACIONES? ")).toBe("¿usted tiene problemas de inundaciones?");
    // "é" precompuesta vs. "e" + tilde combinada
    expect(repeatKey("qué")).toBe(repeatKey("qué"));
  });
  it("quita la burbuja que ya salió (el caso de Caba Decor) y conserva el orden de las demás", () => {
    const yaSalio = ["Claro, Es una barrera…", "Estos son los tamaños que manejamos", "¿Usted tiene problemas de inundaciones?"];
    expect(splitRepeated(["¿Usted tiene problemas de inundaciones?"], yaSalio)).toEqual({ keep: [], dropped: ["¿Usted tiene problemas de inundaciones?"] });
    expect(splitRepeated(["Con gusto.", "¿usted tiene problemas de inundaciones? "], yaSalio)).toEqual({
      keep: ["Con gusto."],
      dropped: ["¿usted tiene problemas de inundaciones? "],
    });
  });
  it("una paráfrasis NO es idéntica (esa la evita la regla de la pregunta del workflow); dos burbujas iguales salen una vez", () => {
    expect(splitRepeated(["Para orientarle, ¿tiene problemas de inundaciones?"], ["¿Usted tiene problemas de inundaciones?"]).dropped).toEqual([]);
    expect(splitRepeated(["Hola", "hola"], [])).toEqual({ keep: ["Hola"], dropped: ["hola"] });
    expect(splitRepeated(["Hola"], [null, ""])).toEqual({ keep: ["Hola"], dropped: [] });
  });
});
