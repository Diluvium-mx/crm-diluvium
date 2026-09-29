// "Ver cambios" del Historial (Bloque E, 28-sep-2026): lo quitado y lo agregado de un
// cambio, resaltado. PURO y seguro para el cliente. Entra el antes/después completo
// (change_history.detail, o dos versiones seguidas de ai_knowledge_versions para el Goal y
// las FAQs) y sale una lista de bloques ya lista para pintar:
// - Goal: por PÁRRAFO (un párrafo editado se resalta por palabras).
// - FAQs: por pregunta (agregada, borrada o editada con antes → después).
// - Workflows: disparadores y paso por paso (texto, archivo, espera).
// - Regla de etapa, nombre del agente, mensajes rápidos, plantillas: texto antes → después.
// - Tallas: por talla (rango antes → después).

import { maxSendsLabel, START_SCOPE_LABEL, startScopeOf } from "@/lib/workflows/steps";

export type DiffOp = "same" | "removed" | "added";
export type DiffSegment = { op: DiffOp; text: string };
/** Una línea de un bloque; `label` = "Pregunta", "Respuesta", "Archivo"… (null = sin etiqueta). */
export type DiffLine = { label: string | null; segments: DiffSegment[] };
export type DiffTag = "agregado" | "quitado" | "editado";
export type DiffBlock = { title: string; tag: DiffTag; lines: DiffLine[] };
/** Lo que pinta "Ver cambios". `unchanged`: nota de lo que quedó igual (p. ej. "12 párrafos sin cambios"). */
export type ChangeDiff = { blocks: DiffBlock[]; unchanged: string | null };

// ── Lo que se guarda en change_history.detail ────────────────────────────────
export type WorkflowDetailStep =
  | { kind: "send_text"; text: string }
  | { kind: "send_media"; title: string; file: string | null; caption: string | null }
  | { kind: "wait"; seconds: number };

export type WorkflowDetail = {
  name: string;
  enabled: boolean;
  agentDescription: string;
  triggerAgent: boolean;
  triggerKeywords: string[];
  triggerCommand: string | null;
  /** Nombre de la etapa (no la clave). */
  triggerStage: string | null;
  /** «Solo al inicio» (29-sep-2026). Ausente en el historial anterior = En cualquier momento. */
  triggerStartOnly?: boolean;
  /** Tercera opción (29-sep-2026): false = solo la palabra clave es al inicio. Ausente = estricto. */
  triggerStartOnlyAgent?: boolean;
  /** «Máximo de envíos por chat» (29-sep-2026). Ausente o null = sin límite. */
  maxSendsPerChat?: number | null;
  /** «El workflow es la respuesta» (29-sep-2026). Ausente = No. */
  isAnswer?: boolean;
  steps: WorkflowDetailStep[];
};

export type SizeRangeDetail = { linea: string; talla: string; minCm: number; maxCm: number };

export type ChangeDetailData =
  | { type: "texto"; title: string; before: string | null; after: string | null }
  | { type: "workflow"; before: WorkflowDetail | null; after: WorkflowDetail | null }
  | { type: "tallas"; before: SizeRangeDetail[]; after: SizeRangeDetail[] }
  | { type: "lineas"; lines: { title: string; before: string | null; after: string | null }[] };

export type FaqDetail = { question: string; answer: string; position?: number; enabled?: boolean; ghlId?: string | null };

// ── Motor: subsecuencia común más larga ──────────────────────────────────────
// Con prefijo y sufijo comunes recortados antes; si aun así queda muy grande, todo lo de
// en medio sale como quitado + agregado (nunca se cuelga con un Goal enorme).
const MAX_CELLS = 4_000_000;

type Step<T> = { op: DiffOp; item: T };

export function diffSequence<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean = Object.is): Step<T>[] {
  let start = 0;
  while (start < a.length && start < b.length && same(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && same(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((item) => ({ op: "same" as const, item }));
  const tail = a.slice(endA).map((item) => ({ op: "same" as const, item }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_CELLS) {
    return [...head, ...midA.map((item) => ({ op: "removed" as const, item })), ...midB.map((item) => ({ op: "added" as const, item })), ...tail];
  }
  // lcs[i][j] = largo de la subsecuencia común de midA[i..] y midB[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = same(midA[i], midB[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const mid: Step<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(midA[i], midB[j])) {
      mid.push({ op: "same", item: midA[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      mid.push({ op: "removed", item: midA[i++] });
    } else {
      mid.push({ op: "added", item: midB[j++] });
    }
  }
  while (i < n) mid.push({ op: "removed", item: midA[i++] });
  while (j < m) mid.push({ op: "added", item: midB[j++] });
  return [...head, ...mid, ...tail];
}

// Palabras con su espacio de antes; la puntuación FINAL (coma, punto…) va aparte, para que
// "{{nombre}}" y "{{nombre}}," cuenten como la misma palabra ("$5,500" no se parte).
const WORD = /\s*\S+?(?=[,.;:!?]*(?:\s|$))|[,.;:!?]+(?=\s|$)|\s+/g;

/** Diferencia por palabras (los espacios viajan con su palabra). Tramos seguidos del mismo tipo se juntan. */
export function diffWords(before: string, after: string): DiffSegment[] {
  const tokens = (s: string) => s.match(WORD) ?? [];
  const steps = diffSequence(tokens(before), tokens(after), (x, y) => x.trim() === y.trim());
  const out: DiffSegment[] = [];
  for (const { op, item } of steps) {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += item;
    else out.push({ op, text: item });
  }
  return out;
}

/** Parecido entre dos textos (0–1, por palabras): para decidir si un párrafo "se editó" o es otro. */
export function similarity(a: string, b: string): number {
  const wa = a.toLowerCase().split(/\s+/).filter(Boolean);
  const wb = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (wa.length === 0 && wb.length === 0) return 1;
  const common = diffSequence(wa, wb).filter((s) => s.op === "same").length;
  return common / Math.max(wa.length, wb.length);
}

const only = (op: "removed" | "added", text: string): DiffSegment[] => (text ? [{ op, text }] : []);

/** Una línea antes → después: igual = solo el texto; cambió = lo quitado y lo agregado. */
function lineDiff(label: string | null, before: string | null, after: string | null): DiffLine {
  if (before === null) return { label, segments: only("added", after ?? "") };
  if (after === null) return { label, segments: only("removed", before) };
  if (before === after) return { label, segments: [{ op: "same", text: after }] };
  return { label, segments: diffWords(before, after) };
}

/** Línea corta (nombre, etapa, archivo…): se muestra entera tachada y entera nueva, sin partir palabras. */
function valueLine(label: string, before: string | null, after: string | null): DiffLine {
  if (before === after) return { label, segments: [{ op: "same", text: after ?? "—" }] };
  if (before === null) return { label, segments: only("added", after ?? "") };
  if (after === null) return { label, segments: only("removed", before) };
  return { label, segments: [...only("removed", before ?? "—"), { op: "same", text: " → " }, ...only("added", after ?? "—")] };
}

function tagOf(before: unknown, after: unknown): DiffTag {
  return before === null || before === undefined ? "agregado" : after === null || after === undefined ? "quitado" : "editado";
}

// ── Goal por párrafo ─────────────────────────────────────────────────────────
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// Un párrafo quitado seguido de uno agregado que se le parece (≥ 40 % de las palabras) es el
// MISMO párrafo editado: se resalta por palabras. Si no se parecen, salen aparte.
const EDIT_SIMILARITY = 0.4;

export function diffGoal(before: string, after: string): ChangeDiff {
  const steps = diffSequence(paragraphs(before), paragraphs(after));
  const blocks: DiffBlock[] = [];
  let unchanged = 0;
  let n = 0; // número de párrafo en la versión nueva
  for (let k = 0; k < steps.length; ) {
    if (steps[k].op === "same") {
      unchanged++;
      n++;
      k++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (k < steps.length && steps[k].op !== "same") {
      if (steps[k].op === "removed") removed.push(steps[k].item);
      else added.push(steps[k].item);
      k++;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < Math.max(removed.length, added.length); p++) {
      const r = removed[p];
      const a = added[p];
      if (p < pairs && similarity(r, a) >= EDIT_SIMILARITY) {
        n++;
        blocks.push({ title: `Párrafo ${n}`, tag: "editado", lines: [{ label: null, segments: diffWords(r, a) }] });
        continue;
      }
      if (r !== undefined) blocks.push({ title: "Párrafo quitado", tag: "quitado", lines: [{ label: null, segments: only("removed", r) }] });
      if (a !== undefined) {
        n++;
        blocks.push({ title: `Párrafo ${n}`, tag: "agregado", lines: [{ label: null, segments: only("added", a) }] });
      }
    }
  }
  return { blocks, unchanged: unchanged > 0 ? `${unchanged} ${unchanged === 1 ? "párrafo" : "párrafos"} sin cambios` : null };
}

// ── FAQs por pregunta ────────────────────────────────────────────────────────
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function faqBlock(before: FaqDetail | null, after: FaqDetail | null): DiffBlock {
  const title = (after ?? before)!.question.trim() || "(sin pregunta)";
  const lines: DiffLine[] = [];
  const b = before;
  const a = after;
  if (!b || !a || b.question.trim() !== a.question.trim()) lines.push(lineDiff("Pregunta", b?.question.trim() ?? null, a?.question.trim() ?? null));
  lines.push(lineDiff("Respuesta", b?.answer.trim() ?? null, a?.answer.trim() ?? null));
  if (b && a && (b.enabled ?? true) !== (a.enabled ?? true)) lines.push(valueLine("Estado", b.enabled === false ? "Apagada" : "Encendida", a.enabled === false ? "Apagada" : "Encendida"));
  return { title, tag: tagOf(b, a), lines };
}

/**
 * Empareja por id de GHL, luego por la misma pregunta y, lo que sobre, por la misma
 * posición (una pregunta reescrita conserva su lugar). Lo demás: agregada o borrada.
 */
export function diffFaqs(before: readonly FaqDetail[], after: readonly FaqDetail[]): ChangeDiff {
  const pending = new Set(before.map((_, i) => i));
  const match = new Map<number, number>(); // after → before
  const take = (ai: number, pick: (f: FaqDetail) => boolean) => {
    for (const bi of pending) {
      if (pick(before[bi])) {
        pending.delete(bi);
        match.set(ai, bi);
        return;
      }
    }
  };
  after.forEach((f, ai) => f.ghlId && take(ai, (b) => b.ghlId === f.ghlId));
  after.forEach((f, ai) => !match.has(ai) && take(ai, (b) => norm(b.question) === norm(f.question)));
  after.forEach((f, ai) => !match.has(ai) && f.position !== undefined && take(ai, (b) => b.position === f.position));

  const blocks: DiffBlock[] = [];
  let unchanged = 0;
  after.forEach((f, ai) => {
    const bi = match.get(ai);
    if (bi === undefined) return void blocks.push(faqBlock(null, f));
    const b = before[bi];
    if (b.question.trim() === f.question.trim() && b.answer.trim() === f.answer.trim() && (b.enabled ?? true) === (f.enabled ?? true)) unchanged++;
    else blocks.push(faqBlock(b, f));
  });
  for (const bi of [...pending].sort((x, y) => x - y)) blocks.push(faqBlock(before[bi], null));
  return { blocks, unchanged: unchanged > 0 ? `${unchanged} ${unchanged === 1 ? "pregunta" : "preguntas"} sin cambios` : null };
}

// ── Workflows: disparadores y paso por paso ──────────────────────────────────
const STEP_KIND: Record<WorkflowDetailStep["kind"], string> = { send_text: "Texto", send_media: "Archivo", wait: "Espera" };
const seconds = (n: number) => `${n} s`;
const yesNo = (v: boolean) => (v ? "Sí" : "No");
const onOff = (v: boolean) => (v ? "Encendido" : "Apagado");

function stepLines(before: WorkflowDetailStep | null, after: WorkflowDetailStep | null): DiffLine[] {
  const b = before;
  const a = after;
  if ((b ?? a)!.kind === "send_text") {
    return [lineDiff(null, b?.kind === "send_text" ? b.text : null, a?.kind === "send_text" ? a.text : null)];
  }
  if ((b ?? a)!.kind === "wait") {
    return [valueLine("Espera", b?.kind === "wait" ? seconds(b.seconds) : null, a?.kind === "wait" ? seconds(a.seconds) : null)];
  }
  const bm = b?.kind === "send_media" ? b : null;
  const am = a?.kind === "send_media" ? a : null;
  const file = (m: typeof bm) => (m ? (m.file ?? "falta el archivo") : null);
  const lines: DiffLine[] = [valueLine("Archivo", file(bm), file(am))];
  if (!bm || !am || bm.title !== am.title) lines.push(valueLine("Qué va aquí", bm?.title ?? null, am?.title ?? null));
  if ((bm?.caption ?? "") || (am?.caption ?? "")) lines.push(lineDiff("Pie", bm ? (bm.caption ?? "") : null, am ? (am.caption ?? "") : null));
  return lines;
}

const stepKey = (s: WorkflowDetailStep) => JSON.stringify(s);

export function diffWorkflow(before: WorkflowDetail | null, after: WorkflowDetail | null): ChangeDiff {
  const blocks: DiffBlock[] = [];
  const b = before;
  const a = after;
  // General: nombre, estado y la descripción que lee el agente.
  const general: DiffLine[] = [];
  if (!b || !a || b.name !== a.name) general.push(valueLine("Nombre", b?.name ?? null, a?.name ?? null));
  if (!b || !a || b.enabled !== a.enabled) general.push(valueLine("Estado", b ? onOff(b.enabled) : null, a ? onOff(a.enabled) : null));
  if (!b || !a || b.agentDescription !== a.agentDescription) {
    if ((b?.agentDescription ?? "") || (a?.agentDescription ?? "")) {
      general.push(lineDiff("Descripción para el agente", b ? b.agentDescription : null, a ? a.agentDescription : null));
    }
  }
  if (general.length) blocks.push({ title: "Workflow", tag: tagOf(b, a), lines: general });

  // Disparadores.
  const kw = (w: WorkflowDetail | null) => (w ? (w.triggerKeywords.length ? w.triggerKeywords.join(", ") : "ninguna") : null);
  const triggers: DiffLine[] = [];
  if (kw(b) !== kw(a)) triggers.push(valueLine("Palabras clave", kw(b), kw(a)));
  const cmd = (w: WorkflowDetail | null) => (w ? (w.triggerCommand ?? "ninguno") : null);
  if (cmd(b) !== cmd(a)) triggers.push(valueLine("Comando", cmd(b), cmd(a)));
  const stage = (w: WorkflowDetail | null) => (w ? (w.triggerStage ?? "ninguna") : null);
  if (stage(b) !== stage(a)) triggers.push(valueLine("Al entrar a la etapa", stage(b), stage(a)));
  const agent = (w: WorkflowDetail | null) => (w ? yesNo(w.triggerAgent) : null);
  if (agent(b) !== agent(a)) triggers.push(valueLine("Lo usa el agente", agent(b), agent(a)));
  const when = (w: WorkflowDetail | null) => (w ? START_SCOPE_LABEL[startScopeOf(w)] : null);
  if (when(b) !== when(a)) triggers.push(valueLine("Cuándo se dispara", when(b), when(a)));
  const max = (w: WorkflowDetail | null) => (w ? maxSendsLabel(w.maxSendsPerChat) : null);
  if (max(b) !== max(a)) triggers.push(valueLine("Máximo por chat", max(b), max(a)));
  const answer = (w: WorkflowDetail | null) => (w ? yesNo(Boolean(w.isAnswer)) : null);
  if (answer(b) !== answer(a)) triggers.push(valueLine("El workflow es la respuesta", answer(b), answer(a)));
  if (triggers.length) blocks.push({ title: "Disparadores", tag: tagOf(b, a), lines: triggers });

  // Pasos: alineados por contenido; un quitado seguido de un agregado del MISMO tipo es
  // el mismo paso editado.
  const steps = diffSequence(b?.steps ?? [], a?.steps ?? [], (x, y) => stepKey(x) === stepKey(y));
  let unchanged = 0;
  let n = 0; // número de paso en la versión nueva
  for (let k = 0; k < steps.length; ) {
    if (steps[k].op === "same") {
      unchanged++;
      n++;
      k++;
      continue;
    }
    const removed: WorkflowDetailStep[] = [];
    const added: WorkflowDetailStep[] = [];
    while (k < steps.length && steps[k].op !== "same") {
      if (steps[k].op === "removed") removed.push(steps[k].item);
      else added.push(steps[k].item);
      k++;
    }
    for (let p = 0; p < Math.max(removed.length, added.length); p++) {
      const r = removed[p] ?? null;
      const ad = added[p] ?? null;
      if (r && ad && r.kind === ad.kind) {
        n++;
        blocks.push({ title: `Paso ${n} · ${STEP_KIND[ad.kind]}`, tag: "editado", lines: stepLines(r, ad) });
        continue;
      }
      if (r) blocks.push({ title: `Paso quitado · ${STEP_KIND[r.kind]}`, tag: "quitado", lines: stepLines(r, null) });
      if (ad) {
        n++;
        blocks.push({ title: `Paso ${n} · ${STEP_KIND[ad.kind]}`, tag: "agregado", lines: stepLines(null, ad) });
      }
    }
  }
  return { blocks, unchanged: b && a && unchanged > 0 ? `${unchanged} ${unchanged === 1 ? "paso" : "pasos"} sin cambios` : null };
}

// ── Tallas ───────────────────────────────────────────────────────────────────
const LINEA: Record<string, string> = { mini: "Mini", estandar: "Estándar" };
const range = (r: SizeRangeDetail) => `${r.minCm}–${r.maxCm} cm`;

export function diffSizeRanges(before: readonly SizeRangeDetail[], after: readonly SizeRangeDetail[]): ChangeDiff {
  const key = (r: SizeRangeDetail) => `${r.linea}\u0000${r.talla.trim().toLowerCase()}`;
  const old = new Map(before.map((r) => [key(r), r]));
  const blocks: DiffBlock[] = [];
  let unchanged = 0;
  for (const r of after) {
    const b = old.get(key(r));
    old.delete(key(r));
    const title = `${LINEA[r.linea] ?? r.linea} · ${r.talla}`;
    if (!b) blocks.push({ title, tag: "agregado", lines: [valueLine("Ancho", null, range(r))] });
    else if (range(b) !== range(r)) blocks.push({ title, tag: "editado", lines: [valueLine("Ancho", range(b), range(r))] });
    else unchanged++;
  }
  for (const b of old.values()) blocks.push({ title: `${LINEA[b.linea] ?? b.linea} · ${b.talla}`, tag: "quitado", lines: [valueLine("Ancho", range(b), null)] });
  return { blocks, unchanged: unchanged > 0 ? `${unchanged} ${unchanged === 1 ? "talla" : "tallas"} sin cambios` : null };
}

/** Resumen corto de un cambio de tallas para la fila ("Mini · 2: 80–100 cm → 80–105 cm" o "3 cambios"). */
export function sizeRangesSummary(before: readonly SizeRangeDetail[], after: readonly SizeRangeDetail[]): { before: string; after: string } | null {
  const { blocks } = diffSizeRanges(before, after);
  if (blocks.length === 0) return null;
  if (blocks.length === 1) {
    const [bl] = blocks;
    const text = (op: DiffOp) => bl.lines[0].segments.find((s) => s.op === op)?.text ?? "—";
    return { before: `${bl.title}: ${text("removed")}`, after: `${bl.title}: ${text("added")}` };
  }
  const n = (x: number) => (x === 1 ? "1 talla" : `${x} tallas`);
  return { before: n(before.length), after: `${n(after.length)} (${blocks.length} cambios)` };
}

// ── Entrada única ────────────────────────────────────────────────────────────
export function buildChangeDiff(detail: ChangeDetailData): ChangeDiff {
  switch (detail.type) {
    case "texto": {
      // Vacío = no había (p. ej. una etapa sin regla): se ve como agregado o quitado.
      const before = detail.before?.trim() ? detail.before : null;
      const after = detail.after?.trim() ? detail.after : null;
      return {
        blocks: before === after ? [] : [{ title: detail.title, tag: tagOf(before, after), lines: [lineDiff(null, before, after)] }],
        unchanged: null,
      };
    }
    case "workflow":
      return diffWorkflow(detail.before, detail.after);
    case "tallas":
      return diffSizeRanges(detail.before, detail.after);
    case "lineas":
      return {
        blocks: detail.lines.map((l) => ({ title: l.title, tag: tagOf(l.before, l.after), lines: [lineDiff(null, l.before, l.after)] })),
        unchanged: null,
      };
  }
}

/** Texto corto para la fila del historial (el completo va en "Ver cambios"). */
export function preview(text: string | null, max = 80): string | null {
  if (text === null) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "(vacía)";
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
