import { describe, expect, it } from "vitest";
import { groupTemplates, templateSection, templateTitle } from "./labels";
import { PICKER_TIME_PHRASE_TEMPLATES, TIME_PHRASE_TEMPLATES } from "@/lib/followups/cases";

const t = (name: string, bodyText: string | null = null) => ({ id: name, name, bodyText });

describe("títulos de las plantillas", () => {
  it("las conocidas tienen título amigable, igual con seg_ que con daniel_", () => {
    expect(templateTitle("seg_precio")).toBe("Precio sin respuesta");
    expect(templateTitle("daniel_precio")).toBe("Precio sin respuesta");
    expect(templateTitle("seg_info_duda")).toBe("¿Le quedó alguna duda?");
    expect(templateTitle("daniel_objecion")).toBe("Lo va a pensar");
    expect(templateTitle("seg_informacion")).toBe("Solo información");
  });
  it("las desconocidas muestran su nombre", () => {
    expect(templateTitle("hola_buenos_dias")).toBe("hola_buenos_dias");
    expect(templateTitle("seg_otra_cosa")).toBe("seg_otra_cosa");
    expect(templateTitle("precio")).toBe("precio");
  });
});

describe("secciones del selector", () => {
  it("por prefijo", () => {
    expect(templateSection("daniel_precio")).toBe("daniel");
    expect(templateSection("seg_valorar")).toBe("seguimiento");
    expect(templateSection("hola_buenas_tardes")).toBe("otras");
  });

  it("orden fijo, sin secciones vacías y respetando el orden de llegada", () => {
    const groups = groupTemplates([t("hola_buenos_dias"), t("seg_precio"), t("seg_asesor")]);
    expect(groups.map((g) => g.title)).toEqual(["Seguimiento", "Otras"]);
    expect(groups[0].items.map((i) => i.name)).toEqual(["seg_precio", "seg_asesor"]);
  });

  it("busca en nombre, título y texto sin acentos ni mayúsculas", () => {
    const all = [t("daniel_medidas", "Hola, ¿ya tomó las medidas?"), t("seg_precio", "Le compartí el precio"), t("hola_buenos_dias", "Buenos días")];
    expect(groupTemplates(all, "MEDIDAS").flatMap((g) => g.items.map((i) => i.name))).toEqual(["daniel_medidas"]);
    expect(groupTemplates(all, "precio sin respuesta").flatMap((g) => g.items.map((i) => i.name))).toEqual(["seg_precio"]);
    expect(groupTemplates(all, "dias").flatMap((g) => g.items.map((i) => i.name))).toEqual(["hola_buenos_dias"]);
    expect(groupTemplates(all, "nada que ver")).toEqual([]);
  });
});

describe("frase de tiempo en {{1}}", () => {
  it("el selector también la pone en las daniel_*, sin tocar el conjunto de los seguimientos automáticos", () => {
    expect(PICKER_TIME_PHRASE_TEMPLATES.has("daniel_precio")).toBe(true);
    expect(PICKER_TIME_PHRASE_TEMPLATES.has("daniel_objecion")).toBe(true);
    expect(PICKER_TIME_PHRASE_TEMPLATES.has("seg_precio")).toBe(true);
    expect([...TIME_PHRASE_TEMPLATES].some((name) => name.startsWith("daniel_"))).toBe(false);
  });
});
