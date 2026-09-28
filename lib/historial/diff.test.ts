// "Ver cambios" (Bloque E, puro): lo quitado y lo agregado del Goal por párrafo, de las FAQs
// por pregunta, de los workflows paso por paso, de las tallas y de los textos.
import { describe, expect, it } from "vitest";
import {
  buildChangeDiff,
  diffFaqs,
  diffGoal,
  diffSequence,
  diffSizeRanges,
  diffWords,
  diffWorkflow,
  paragraphs,
  preview,
  sizeRangesSummary,
  type DiffSegment,
  type WorkflowDetail,
} from "./diff";

const text = (segs: DiffSegment[], op: DiffSegment["op"]) =>
  segs
    .filter((s) => s.op === op)
    .map((s) => s.text.trim())
    .join(" | ");

describe("motor", () => {
  it("subsecuencia común: quitado, agregado e igual en orden", () => {
    expect(diffSequence(["a", "b", "c"], ["a", "x", "c"])).toEqual([
      { op: "same", item: "a" },
      { op: "removed", item: "b" },
      { op: "added", item: "x" },
      { op: "same", item: "c" },
    ]);
  });

  it("por palabras: solo se marca lo que cambió", () => {
    const segs = diffWords("Hola Juan, el precio es $5,500 más IVA", "Hola Juan, el precio es $6,000 más IVA");
    expect(text(segs, "removed")).toBe("$5,500");
    expect(text(segs, "added")).toBe("$6,000");
    expect(segs.map((s) => s.text).join("")).toContain("Hola Juan, el precio es");
  });

  it("la puntuación final no cuenta como otra palabra; nada se pierde al partir", () => {
    const segs = diffWords("Hola {{nombre}}", "Hola {{nombre}}, soy {{vendedor}}.");
    expect(text(segs, "removed")).toBe("");
    expect(text(segs, "added")).toBe(", soy {{vendedor}}.");
    for (const s of ["a,b.c  ¿sí?  ...fin.", "  espacios  ", "$5,500.", ""]) {
      expect(diffWords(s, s).map((x) => x.text).join("")).toBe(s);
    }
  });

  it("párrafos = separados por una línea en blanco", () => {
    expect(paragraphs("Uno\nsigue uno\n\n\nDos\n  \nTres")).toEqual(["Uno\nsigue uno", "Dos", "Tres"]);
  });
});

describe("Goal por párrafo", () => {
  const before = "Eres Ángela, asesora de Diluvium.\n\nLa compuerta estándar cuesta $5,500.\n\nNunca des descuentos.";

  it("párrafo editado: se resalta por palabras; lo igual solo se cuenta", () => {
    const d = diffGoal(before, before.replace("$5,500", "$6,000"));
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0]).toMatchObject({ title: "Párrafo 2", tag: "editado" });
    expect(text(d.blocks[0].lines[0].segments, "removed")).toBe("$5,500");
    expect(text(d.blocks[0].lines[0].segments, "added")).toBe("$6,000");
    expect(d.unchanged).toBe("2 párrafos sin cambios");
  });

  it("párrafo agregado y párrafo quitado (distintos) salen aparte", () => {
    const after = "Eres Ángela, asesora de Diluvium.\n\nEnvío gratis a todo Sinaloa.\n\nNunca des descuentos.";
    const d = diffGoal(before, after);
    expect(d.blocks.map((b) => [b.title, b.tag])).toEqual([
      ["Párrafo quitado", "quitado"],
      ["Párrafo 2", "agregado"],
    ]);
    expect(d.blocks[0].lines[0].segments).toEqual([{ op: "removed", text: "La compuerta estándar cuesta $5,500." }]);
    expect(d.blocks[1].lines[0].segments).toEqual([{ op: "added", text: "Envío gratis a todo Sinaloa." }]);
  });

  it("sin cambios = sin bloques", () => {
    expect(diffGoal(before, before)).toEqual({ blocks: [], unchanged: "3 párrafos sin cambios" });
  });
});

describe("FAQs por pregunta", () => {
  const before = [
    { question: "¿Cuánto cuesta?", answer: "$5,500", position: 0 },
    { question: "¿Hacen envíos?", answer: "Sí, a todo México", position: 1 },
    { question: "¿Instalan?", answer: "No", position: 2 },
  ];

  it("agregada, borrada y editada (antes → después)", () => {
    const after = [
      { question: "¿Cuánto cuesta?", answer: "$6,000", position: 0 },
      { question: "¿Hacen envíos?", answer: "Sí, a todo México", position: 1 },
      { question: "¿Tienen garantía?", answer: "Un año", position: 3 },
    ];
    const d = diffFaqs(before, after);
    expect(d.blocks.map((b) => [b.title, b.tag])).toEqual([
      ["¿Cuánto cuesta?", "editado"],
      ["¿Tienen garantía?", "agregado"],
      ["¿Instalan?", "quitado"],
    ]);
    const edited = d.blocks[0].lines;
    expect(edited.map((l) => l.label)).toEqual(["Respuesta"]);
    expect(text(edited[0].segments, "removed")).toBe("$5,500");
    expect(text(edited[0].segments, "added")).toBe("$6,000");
    expect(d.unchanged).toBe("1 pregunta sin cambios");
  });

  it("pregunta reescrita en su mismo lugar = editada (no borrada + agregada)", () => {
    const after = [{ question: "¿Cuál es el precio?", answer: "$5,500", position: 0 }, before[1], before[2]];
    const d = diffFaqs(before, after);
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0]).toMatchObject({ title: "¿Cuál es el precio?", tag: "editado" });
    expect(d.blocks[0].lines.map((l) => l.label)).toEqual(["Pregunta", "Respuesta"]);
  });

  it("apagar una pregunta se ve como cambio de estado", () => {
    const d = diffFaqs(before, [before[0], before[1], { ...before[2], enabled: false }]);
    expect(d.blocks[0].lines.at(-1)).toEqual({
      label: "Estado",
      segments: [
        { op: "removed", text: "Encendida" },
        { op: "same", text: " → " },
        { op: "added", text: "Apagada" },
      ],
    });
  });
});

describe("workflows paso por paso", () => {
  const base: WorkflowDetail = {
    name: "Datos bancarios",
    enabled: true,
    agentDescription: "Cuando el cliente pide dónde pagar.",
    triggerAgent: true,
    triggerKeywords: ["banco"],
    triggerCommand: "/banco",
    triggerStage: null,
    steps: [
      { kind: "send_text", text: "Te paso los datos de pago" },
      { kind: "wait", seconds: 30 },
      { kind: "send_media", title: "Cuenta BBVA", file: "bbva.jpg", caption: null },
    ],
  };

  it("texto editado, espera cambiada, archivo cambiado y disparadores", () => {
    const after: WorkflowDetail = {
      ...base,
      triggerKeywords: ["banco", "transferencia"],
      triggerStage: "Cerca de comprar",
      steps: [
        { kind: "send_text", text: "Te paso los datos de pago actualizados" },
        { kind: "wait", seconds: 20 },
        { kind: "send_media", title: "Cuenta BBVA", file: "bbva-2026.jpg", caption: "CLABE nueva" },
      ],
    };
    const d = diffWorkflow(base, after);
    expect(d.blocks.map((b) => [b.title, b.tag])).toEqual([
      ["Disparadores", "editado"],
      ["Paso 1 · Texto", "editado"],
      ["Paso 2 · Espera", "editado"],
      ["Paso 3 · Archivo", "editado"],
    ]);
    expect(d.blocks[0].lines.map((l) => l.label)).toEqual(["Palabras clave", "Al entrar a la etapa"]);
    expect(text(d.blocks[1].lines[0].segments, "added")).toBe("actualizados");
    expect(d.blocks[2].lines[0].segments).toEqual([
      { op: "removed", text: "30 s" },
      { op: "same", text: " → " },
      { op: "added", text: "20 s" },
    ]);
    expect(d.blocks[3].lines.map((l) => l.label)).toEqual(["Archivo", "Pie"]);
    expect(text(d.blocks[3].lines[0].segments, "added")).toBe("bbva-2026.jpg");
    expect(d.unchanged).toBeNull();
  });

  it("paso agregado al inicio: los demás quedan iguales (no se marcan todos)", () => {
    const after = { ...base, steps: [{ kind: "send_text" as const, text: "¡Hola!" }, ...base.steps] };
    const d = diffWorkflow(base, after);
    expect(d.blocks.map((b) => [b.title, b.tag])).toEqual([["Paso 1 · Texto", "agregado"]]);
    expect(d.unchanged).toBe("3 pasos sin cambios");
  });

  it("paso quitado; nombre y estado", () => {
    const after = { ...base, name: "Datos de pago", enabled: false, steps: [base.steps[0], base.steps[2]] };
    const d = diffWorkflow(base, after);
    expect(d.blocks.map((b) => [b.title, b.tag])).toEqual([
      ["Workflow", "editado"],
      ["Paso quitado · Espera", "quitado"],
    ]);
    expect(d.blocks[0].lines.map((l) => l.label)).toEqual(["Nombre", "Estado"]);
  });

  it("creado y borrado: todo agregado o todo quitado", () => {
    expect(diffWorkflow(null, base).blocks.every((b) => b.tag === "agregado")).toBe(true);
    const gone = diffWorkflow(base, null);
    expect(gone.blocks.every((b) => b.tag === "quitado")).toBe(true);
    expect(gone.blocks.filter((b) => b.title.startsWith("Paso"))).toHaveLength(3);
  });
});

describe("tallas", () => {
  const before = [
    { linea: "estandar", talla: "1", minCm: 60, maxCm: 90 },
    { linea: "estandar", talla: "2", minCm: 91, maxCm: 120 },
    { linea: "mini", talla: "M", minCm: 40, maxCm: 59 },
  ];

  it("rango cambiado, talla nueva y talla quitada", () => {
    const after = [
      { linea: "estandar", talla: "1", minCm: 60, maxCm: 95 },
      { linea: "estandar", talla: "2", minCm: 96, maxCm: 120 },
      { linea: "estandar", talla: "3", minCm: 121, maxCm: 150 },
    ];
    const d = diffSizeRanges(before, after);
    expect(d.blocks.map((b) => [b.title, b.tag])).toEqual([
      ["Estándar · 1", "editado"],
      ["Estándar · 2", "editado"],
      ["Estándar · 3", "agregado"],
      ["Mini · M", "quitado"],
    ]);
    expect(sizeRangesSummary(before, after)).toEqual({ before: "3 tallas", after: "3 tallas (4 cambios)" });
  });

  it("un solo cambio: la fila lo dice completo; sin cambios = null", () => {
    const after = [{ ...before[0], maxCm: 95 }, before[1], before[2]];
    expect(sizeRangesSummary(before, after)).toEqual({ before: "Estándar · 1: 60–90 cm", after: "Estándar · 1: 60–95 cm" });
    expect(sizeRangesSummary(before, before)).toBeNull();
  });
});

describe("textos (regla de etapa, nombre del agente, mensajes rápidos)", () => {
  it("antes → después resaltado; creado = todo agregado; borrado = todo quitado", () => {
    const edit = buildChangeDiff({ type: "texto", title: "Regla del Agente IA", before: "Mover cuando pida precio", after: "Mover cuando pida precio o medidas" });
    expect(edit.blocks[0]).toMatchObject({ title: "Regla del Agente IA", tag: "editado" });
    expect(text(edit.blocks[0].lines[0].segments, "added")).toBe("o medidas");
    expect(buildChangeDiff({ type: "texto", title: "Mensaje", before: null, after: "Hola {{nombre}}" }).blocks[0]).toMatchObject({
      tag: "agregado",
      lines: [{ label: null, segments: [{ op: "added", text: "Hola {{nombre}}" }] }],
    });
    expect(buildChangeDiff({ type: "texto", title: "Mensaje", before: "Adiós", after: null }).blocks[0].tag).toBe("quitado");
  });

  it("líneas (sincronizar plantillas)", () => {
    const d = buildChangeDiff({ type: "lineas", lines: [{ title: "bienvenida (es_MX) · estado", before: "En revisión", after: "Aprobada" }] });
    expect(d.blocks[0]).toMatchObject({ title: "bienvenida (es_MX) · estado", tag: "editado" });
  });

  it("vista previa corta para la fila", () => {
    expect(preview("a".repeat(100), 10)).toBe("aaaaaaaaa…");
    expect(preview("  \n ")).toBe("(vacía)");
    expect(preview(null)).toBeNull();
  });
});
