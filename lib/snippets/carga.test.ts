import { describe, expect, it } from "vitest";
import { planSnippetLoad, validateDesired, verifySnippetLoad, type ExistingSnippet, type SnippetLoadPlan } from "./carga";
import { MENSAJES_RAPIDOS_DILUVIUM } from "./mensajes-rapidos-diluvium";
import { filterSnippets } from "./slash";
import { extractVariables } from "./variables";

// Aplica el plan sobre una copia en memoria, como lo haría el script en la base.
function apply(existing: ExistingSnippet[], plan: SnippetLoadPlan): ExistingSnippet[] {
  const rows = existing.map((row) => ({ ...row }));
  for (const change of plan.update) {
    const row = rows.find((candidate) => candidate.id === change.id);
    if (!row) throw new Error(`no existe ${change.id}`);
    row.name = change.to.name;
    row.body = change.to.body;
  }
  plan.create.forEach((item, index) => rows.push({ id: `nuevo-${rows.length}-${index}`, ...item }));
  return rows;
}

const DESIRED = [
  { name: "Precio", body: "Ahorita tenemos cualquier tamaño en $5,500 con envío gratis." },
  { name: "Buenas tardes 🌅", body: "Hola, buenas tardes. Aquí Daniel, de Diluvium 🌅", previousNames: ["Buenas tardes"] },
  { name: "Usted", body: "¿Usted tiene problemas de inundaciones?" },
];

describe("planSnippetLoad", () => {
  it("con la organización vacía crea todos", () => {
    const plan = planSnippetLoad([], DESIRED);
    expect(plan.create.map((s) => s.name)).toEqual(["Precio", "Buenas tardes 🌅", "Usted"]);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.untouched).toEqual([]);
  });

  it("actualiza por nombre el texto de uno que ya existe", () => {
    const plan = planSnippetLoad([{ id: "s1", name: "Precio", body: "Precio viejo" }], DESIRED);
    expect(plan.update).toEqual([
      { id: "s1", from: { name: "Precio", body: "Precio viejo" }, to: { name: "Precio", body: DESIRED[0].body } },
    ]);
    expect(plan.create.map((s) => s.name)).toEqual(["Buenas tardes 🌅", "Usted"]);
  });

  it('"Buenas tardes" se actualiza al nuevo nombre y texto, sin duplicarse', () => {
    const existing = [{ id: "bt", name: "Buenas tardes", body: "Buenas tardes, soy Daniel" }];
    const plan = planSnippetLoad(existing, DESIRED);
    expect(plan.update).toEqual([
      {
        id: "bt",
        from: { name: "Buenas tardes", body: "Buenas tardes, soy Daniel" },
        to: { name: "Buenas tardes 🌅", body: "Hola, buenas tardes. Aquí Daniel, de Diluvium 🌅" },
      },
    ]);
    expect(plan.create.map((s) => s.name)).toEqual(["Precio", "Usted"]);
    const after = apply(existing, plan);
    expect(after.filter((row) => row.name.startsWith("Buenas tardes"))).toHaveLength(1);
  });

  it("si ya existen el nombre nuevo y el viejo, usa el nuevo y el viejo no se toca (solo se avisa)", () => {
    const existing = [
      { id: "viejo", name: "Buenas tardes", body: "texto viejo" },
      { id: "nuevo", name: "Buenas tardes 🌅", body: "otro texto" },
    ];
    const plan = planSnippetLoad(existing, DESIRED);
    expect(plan.update.map((u) => u.id)).toEqual(["nuevo"]);
    expect(plan.untouched.map((row) => row.id)).toEqual(["viejo"]);
    expect(plan.similar).toEqual([{ existing: existing[0], desiredName: "Buenas tardes 🌅" }]);
  });

  it("deja igual lo que ya coincide en nombre y texto", () => {
    const existing = [{ id: "u", name: "Usted", body: "¿Usted tiene problemas de inundaciones?" }];
    const plan = planSnippetLoad(existing, DESIRED);
    expect(plan.unchanged).toEqual(existing);
    expect(plan.update).toEqual([]);
  });

  it("no toca ni borra los que no están en la lista", () => {
    const otros = [
      { id: "o1", name: "Saludo", body: "Hola {{nombre}}" },
      { id: "o2", name: "Seguimiento", body: "¿Pudiste revisar la cotización?" },
    ];
    const plan = planSnippetLoad(otros, DESIRED);
    expect(plan.untouched).toEqual(otros);
    expect(plan.update).toEqual([]);
    const after = apply(otros, plan);
    expect(verifySnippetLoad(after, DESIRED, plan.untouched)).toEqual([]);
    expect(after.filter((row) => row.id === "o1" || row.id === "o2")).toEqual(otros);
  });

  it("correrlo dos veces no duplica nada: la segunda vez todo queda igual", () => {
    const start = [
      { id: "bt", name: "Buenas tardes", body: "viejo" },
      { id: "o1", name: "Saludo", body: "Hola" },
    ];
    const first = planSnippetLoad(start, MENSAJES_RAPIDOS_DILUVIUM);
    const afterFirst = apply(start, first);
    expect(afterFirst).toHaveLength(23); // 22 de la lista + el que no se toca
    const second = planSnippetLoad(afterFirst, MENSAJES_RAPIDOS_DILUVIUM);
    expect(second.create).toEqual([]);
    expect(second.update).toEqual([]);
    expect(second.unchanged).toHaveLength(22);
    expect(second.untouched.map((row) => row.id)).toEqual(["o1"]);
    expect(apply(afterFirst, second)).toEqual(afterFirst);
  });

  it("un parecido por mayúsculas o acentos no se toca: se crea el de la lista y se avisa", () => {
    const existing = [{ id: "p", name: "precio", body: "otro" }];
    const plan = planSnippetLoad(existing, DESIRED);
    expect(plan.create.map((s) => s.name)).toContain("Precio");
    expect(plan.untouched).toEqual(existing);
    expect(plan.similar).toEqual([{ existing: existing[0], desiredName: "Precio" }]);
  });

  it("empata un nombre con espacios sobrantes y lo deja limpio", () => {
    const plan = planSnippetLoad([{ id: "e", name: "Usted ", body: "¿Usted tiene problemas de inundaciones?" }], DESIRED);
    expect(plan.update).toEqual([
      {
        id: "e",
        from: { name: "Usted ", body: "¿Usted tiene problemas de inundaciones?" },
        to: { name: "Usted", body: "¿Usted tiene problemas de inundaciones?" },
      },
    ]);
  });

  it("no adivina si dos filas empatan el mismo nombre con espacios distintos", () => {
    const existing = [
      { id: "a", name: "Usted ", body: "x" },
      { id: "b", name: " Usted", body: "y" },
    ];
    expect(() => planSnippetLoad(existing, DESIRED)).toThrow(/revisar a mano/);
  });
});

describe("verifySnippetLoad", () => {
  it("detecta duplicados, textos distintos y cambios en los que no se tocan", () => {
    const untouched = [{ id: "o1", name: "Saludo", body: "Hola" }];
    const after = [
      { id: "1", name: "Precio", body: "otro texto" },
      { id: "2", name: "Usted", body: DESIRED[2].body },
      { id: "3", name: "Usted", body: DESIRED[2].body },
      { id: "o1", name: "Saludo", body: "Hola cambiado" },
    ];
    expect(verifySnippetLoad(after, DESIRED, untouched)).toEqual([
      '"Precio": el texto no quedó igual a la lista.',
      '"Buenas tardes 🌅": hay 0 con ese nombre (se esperaba 1).',
      '"Usted": hay 2 con ese nombre (se esperaba 1).',
      '"Saludo" cambió (no se debía tocar).',
    ]);
  });
});

describe("lista de Diluvium", () => {
  it("son 22, pasan la validación y ninguno lleva variables", () => {
    expect(MENSAJES_RAPIDOS_DILUVIUM).toHaveLength(22);
    expect(() => validateDesired(MENSAJES_RAPIDOS_DILUVIUM)).not.toThrow();
    for (const item of MENSAJES_RAPIDOS_DILUVIUM) expect(extractVariables(item.body)).toEqual([]);
  });

  it("solo en prod existía \"Buenas tardes\": queda 1 actualizado + 21 nuevos = 22", () => {
    const plan = planSnippetLoad([{ id: "bt", name: "Buenas tardes", body: "viejo" }], MENSAJES_RAPIDOS_DILUVIUM);
    expect(plan.update).toHaveLength(1);
    expect(plan.create).toHaveLength(21);
    expect(apply([{ id: "bt", name: "Buenas tardes", body: "viejo" }], plan)).toHaveLength(22);
  });

  it("los textos con saltos de línea van con salto real", () => {
    const byName = new Map(MENSAJES_RAPIDOS_DILUVIUM.map((item) => [item.name, item.body]));
    expect(byName.get("Datos de envío")).toBe(
      "También necesitaremos los datos de envío:\nNombre de quien recibe\nDirección\nCódigo postal\nTeléfono\nCorreo electrónico",
    );
    expect(byName.get("Pagos")?.split("\n")).toEqual([
      "Tenemos dos métodos de pago:",
      "1. Depósito o transferencia (le mandaríamos los datos bancarios).",
      "2. Tarjeta de crédito o débito a través de Mercado Pago (la plataforma de pagos de Mercado Libre).",
    ]);
    const conSalto = MENSAJES_RAPIDOS_DILUVIUM.filter((item) => item.body.includes("\n")).map((item) => item.name);
    expect(conSalto).toEqual(["Datos de envío", "Pagos"]);
  });

  it('el buscador "/" encuentra "Cuánta agua entra" con "cuanta"', () => {
    expect(filterSnippets(MENSAJES_RAPIDOS_DILUVIUM, "cuanta")[0].name).toBe("Cuánta agua entra");
  });
});
