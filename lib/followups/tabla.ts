// Tabla editable de los seguimientos (Agente IA › Seguimientos, Parte 4; aprobada por el dueño el
// 6-oct-2026). PURO y seguro para el cliente: valores de fábrica, validación (Zod), la tabla de la
// organización a partir de lo guardado y la lista de cambios (confirmación e Historial).
//
// Por caso: encendido, qué intentos salen (casillas 1.º 2.º 3.º; los tiempos no se editan: 1.º antes
// de que cierre la ventana, 2.º día 2, 3.º día 9), la hora (desde/hasta, hora del cliente, dentro de
// 7:00–21:00) y «Qué busca» (lo lee el Agente IA al escribir el seguimiento). Además, el horario de los
// vendedores (hora de Mazatlán) con el que se presentan las sugerencias. Fijo en el código: 7:00–21:00,
// plantillas hasta las 19:00 (con «Cambiar hora», hasta las 21:00) y 7 días entre plantillas (cases.ts).
//
// En ai_config: `seguimientos_casos` y `seguimientos_vendedores` (migración 0062); null = de fábrica.
// Un caso guardado que ya no valide (editado a mano) vuelve al de fábrica: nunca queda uno imposible.
import { z } from "zod";
import { ALLOWED_FROM, ALLOWED_TO, CASE_RULES, FOLLOW_UP_CASES, type FollowUpCase } from "./cases";
import { isHhmm, minutesOf } from "./time";

export type EditableCase = Exclude<FollowUpCase, "no_seguir">;
/** Los casos de la tabla, en orden de prioridad («No seguir» nunca sale: no se edita). */
export const EDITABLE_CASES = FOLLOW_UP_CASES.filter((c): c is EditableCase => c !== "no_seguir");

/** Intentos posibles por caso (1.º antes del cierre, 2.º día 2, 3.º día 9). */
export const MAX_STEPS = 3;
export const MAX_BUSCA = 400;

export type CaseSetting = {
  on: boolean;
  /** Qué intento sale: [1.º, 2.º, 3.º]. */
  intentos: [boolean, boolean, boolean];
  /** Hora del caso (hora local del cliente). */
  from: string;
  to: string;
  /** Qué busca el mensaje (lo lee el Agente IA). */
  busca: string;
};

export type VendorShift = { from: string; to: string };
/** 1 = lunes … 7 = domingo; null = no trabaja. */
export type VendorShifts = Readonly<Record<number, VendorShift | null>>;
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_LABEL: Readonly<Record<number, string>> = { 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 7: "Dom" };

export type FollowUpTable = {
  casos: Readonly<Record<EditableCase, CaseSetting>>;
  vendedores: VendorShifts;
};

// ── Fábrica ──────────────────────────────────────────────────────────────────

/** Qué busca cada caso: las guías que ya tenía el lector (docs/seguimientos.md §14). */
const FACTORY_BUSCA: Readonly<Record<EditableCase, string>> = {
  asesor_sin_respuesta: "Disculparse por la espera y resolver lo que pidió.",
  pidio_fecha: 'Retomar justo lo que quedó ("¿Pudo medir la entrada?" si iba a medir, "¿Pudo hacer el depósito?" si iba a pagar).',
  pago_pendiente: "El comprobante, o resolver lo que lo frena (forma de pago, meses sin intereses, fecha de entrega).",
  objecion: "Contestar esa duda u objeción con algo útil (la mini compuerta si es caro, hasta dónde protege, los meses sin intereses).",
  cotizacion_sin_respuesta: "Resolver la duda que lo frena (instalación, envío, si le queda) y ofrecer apartarla o los datos de pago.",
  faltan_medidas: "El dato exacto que falta (cuál de las entradas, con cómo medir: de lado a lado, en cm).",
  precio_sin_respuesta:
    'Avanzar un paso según cómo quedó: si nunca se le pidió el ancho de su entrada, pídelo ("¿Qué ancho tiene la entrada que quiere proteger? Con esa medida le digo qué tamaño le queda."); si ya se le pidió, pregunta si le quedó alguna duda de la compuerta; si dejó una duda sin contestar, contéstala.',
  solo_informacion:
    'Avanzar un paso según cómo quedó: si nunca se le pidió el ancho de su entrada, pídelo ("¿Qué ancho tiene la entrada que quiere proteger? Con esa medida le digo qué tamaño le queda."); si ya se le pidió, pregunta si le quedó alguna duda de la compuerta; si dejó una duda sin contestar, contéstala.',
  sin_punto_claro: "Una pregunta sobre su caso que nadie le haya hecho.",
};

function factoryCase(caso: EditableCase): CaseSetting {
  const rule = CASE_RULES[caso];
  return {
    on: true,
    intentos: [rule.total >= 1, rule.total >= 2, rule.total >= 3],
    from: rule.slot!.from,
    to: rule.slot!.to,
    busca: FACTORY_BUSCA[caso],
  };
}

/** De los datos de GHL (may–sep 2026): lunes a viernes 9:00–18:00, sábado 9:00–13:00; domingo, nada. */
export const FACTORY_VENDOR_SHIFTS: VendorShifts = {
  1: { from: "09:00", to: "18:00" },
  2: { from: "09:00", to: "18:00" },
  3: { from: "09:00", to: "18:00" },
  4: { from: "09:00", to: "18:00" },
  5: { from: "09:00", to: "18:00" },
  6: { from: "09:00", to: "13:00" },
  7: null,
};

export const FACTORY_TABLE: FollowUpTable = {
  casos: Object.fromEntries(EDITABLE_CASES.map((c) => [c, factoryCase(c)])) as Record<EditableCase, CaseSetting>,
  vendedores: FACTORY_VENDOR_SHIFTS,
};

// ── Validación ───────────────────────────────────────────────────────────────

const hhmm = z.string().refine(isHhmm, "Hora inválida (HH:MM).");

export const caseSettingSchema = z
  .object({
    on: z.boolean(),
    intentos: z.tuple([z.boolean(), z.boolean(), z.boolean()]),
    from: hhmm,
    to: hhmm,
    busca: z.string().transform((s) => s.replace(/\s+/g, " ").trim()),
  })
  .superRefine((c, ctx) => {
    if (isHhmm(c.from) && isHhmm(c.to)) {
      if (minutesOf(c.from) < minutesOf(ALLOWED_FROM) || minutesOf(c.to) > minutesOf(ALLOWED_TO)) {
        ctx.addIssue({ code: "custom", path: ["from"], message: "La hora va de 7:00 a 21:00 (hora del cliente)." });
      } else if (minutesOf(c.from) >= minutesOf(c.to)) {
        ctx.addIssue({ code: "custom", path: ["to"], message: "«Hasta» debe ser después de «desde»." });
      }
    }
    if (c.on && !c.intentos.some(Boolean)) ctx.addIssue({ code: "custom", path: ["intentos"], message: "Prende al menos un intento o apaga el caso." });
    if (!c.busca) ctx.addIssue({ code: "custom", path: ["busca"], message: "Escribe qué busca el mensaje." });
    else if (c.busca.length > MAX_BUSCA) ctx.addIssue({ code: "custom", path: ["busca"], message: `Máximo ${MAX_BUSCA} letras.` });
  });

export const vendorShiftSchema = z
  .object({ from: hhmm, to: hhmm })
  .nullable()
  .superRefine((s, ctx) => {
    if (s && isHhmm(s.from) && isHhmm(s.to) && minutesOf(s.from) >= minutesOf(s.to)) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "La salida debe ser después de la entrada." });
    }
  });

export const followUpTableSchema = z.object({
  casos: z.object(Object.fromEntries(EDITABLE_CASES.map((c) => [c, caseSettingSchema])) as Record<EditableCase, typeof caseSettingSchema>),
  vendedores: z.object(Object.fromEntries(WEEKDAYS.map((d) => [String(d), vendorShiftSchema])) as Record<string, typeof vendorShiftSchema>),
});

/** Lo que manda la pantalla (vendedores con llaves "1".."7"). */
export type FollowUpTableInput = z.input<typeof followUpTableSchema>;

/** Problemas para mostrar junto a cada control: "pago_pendiente.from" → mensaje. */
export function tableProblems(input: FollowUpTableInput): Record<string, string> {
  const parsed = followUpTableSchema.safeParse(input);
  if (parsed.success) return {};
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.slice(1).join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** La pantalla → la tabla (ya validada). */
export function tableFromInput(input: FollowUpTableInput): FollowUpTable {
  const parsed = followUpTableSchema.parse(input);
  return {
    casos: parsed.casos as Record<EditableCase, CaseSetting>,
    vendedores: Object.fromEntries(WEEKDAYS.map((d) => [d, parsed.vendedores[String(d)] ?? null])),
  };
}

export function tableToInput(table: FollowUpTable): FollowUpTableInput {
  return {
    casos: Object.fromEntries(EDITABLE_CASES.map((c) => [c, { ...table.casos[c], intentos: [...table.casos[c].intentos] }])) as FollowUpTableInput["casos"],
    vendedores: Object.fromEntries(WEEKDAYS.map((d) => [String(d), table.vendedores[d] ? { ...table.vendedores[d]! } : null])),
  };
}

// ── De lo guardado a la tabla ────────────────────────────────────────────────

/** Columnas de ai_config (null = de fábrica). Un caso o día que no valide queda de fábrica. */
export function tableFromStored(casos: unknown, vendedores: unknown): FollowUpTable {
  const storedCases = casos && typeof casos === "object" ? (casos as Record<string, unknown>) : {};
  const outCases = {} as Record<EditableCase, CaseSetting>;
  for (const c of EDITABLE_CASES) {
    const parsed = caseSettingSchema.safeParse(storedCases[c]);
    outCases[c] = parsed.success ? parsed.data : factoryCase(c);
  }
  let outShifts: VendorShifts = FACTORY_VENDOR_SHIFTS;
  if (vendedores && typeof vendedores === "object") {
    const stored = vendedores as Record<string, unknown>;
    const shifts: Record<number, VendorShift | null> = {};
    for (const d of WEEKDAYS) {
      const parsed = vendorShiftSchema.safeParse(stored[String(d)]);
      shifts[d] = parsed.success ? parsed.data : FACTORY_VENDOR_SHIFTS[d];
    }
    outShifts = shifts;
  }
  return { casos: outCases, vendedores: outShifts };
}

/** Lo que se guarda (null = igual que la fábrica: así un cambio futuro de la fábrica sí llega). */
export function tableToStored(table: FollowUpTable): { casos: Record<string, CaseSetting> | null; vendedores: Record<string, VendorShift | null> | null } {
  const casos = sameCases(table, FACTORY_TABLE) ? null : Object.fromEntries(EDITABLE_CASES.map((c) => [c, table.casos[c]]));
  const vendedores = sameShifts(table.vendedores, FACTORY_VENDOR_SHIFTS) ? null : Object.fromEntries(WEEKDAYS.map((d) => [String(d), table.vendedores[d] ?? null]));
  return { casos, vendedores };
}

function sameCases(a: FollowUpTable, b: FollowUpTable): boolean {
  return EDITABLE_CASES.every((c) => JSON.stringify(a.casos[c]) === JSON.stringify(b.casos[c]));
}
function sameShifts(a: VendorShifts, b: VendorShifts): boolean {
  return WEEKDAYS.every((d) => JSON.stringify(a[d] ?? null) === JSON.stringify(b[d] ?? null));
}

// ── Intentos ─────────────────────────────────────────────────────────────────

export function caseOn(table: FollowUpTable, caso: FollowUpCase): boolean {
  return caso !== "no_seguir" && table.casos[caso].on;
}

/** Hora del caso en la tabla. */
export function slotOf(table: FollowUpTable, caso: EditableCase): { from: string; to: string } {
  const s = table.casos[caso];
  return { from: s.from, to: s.to };
}

/** El primer intento prendido DESPUÉS de `after` (0 = desde el 1.º); null si no queda ninguno. */
export function nextStep(table: FollowUpTable, caso: EditableCase, after: number): number | null {
  const steps = table.casos[caso].intentos;
  for (let k = Math.max(1, after + 1); k <= MAX_STEPS; k++) if (steps[k - 1]) return k;
  return null;
}

/** El último intento prendido (0 si ninguno). */
export function lastStep(table: FollowUpTable, caso: EditableCase): number {
  const steps = table.casos[caso].intentos;
  for (let k = MAX_STEPS; k >= 1; k--) if (steps[k - 1]) return k;
  return 0;
}

// ── Cambios (confirmación e Historial) ───────────────────────────────────────

export type TableChange = { title: string; before: string | null; after: string | null };

const STEP_NAME = ["1.er intento", "2.º intento", "3.er intento"] as const;
const range = (s: { from: string; to: string }) => `${s.from}–${s.to}`;

/** Lo que cambió, una línea por dato («Faltan medidas · 3.er intento: apagado → prendido»). */
export function tableChanges(before: FollowUpTable, after: FollowUpTable): TableChange[] {
  const out: TableChange[] = [];
  for (const c of EDITABLE_CASES) {
    const a = before.casos[c];
    const b = after.casos[c];
    const label = CASE_RULES[c].label;
    if (a.on !== b.on) out.push({ title: label, before: a.on ? "encendido" : "apagado", after: b.on ? "encendido" : "apagado" });
    for (let k = 0; k < MAX_STEPS; k++) {
      if (a.intentos[k] !== b.intentos[k]) out.push({ title: `${label} · ${STEP_NAME[k]}`, before: a.intentos[k] ? "prendido" : "apagado", after: b.intentos[k] ? "prendido" : "apagado" });
    }
    if (a.from !== b.from || a.to !== b.to) out.push({ title: `${label} · hora`, before: range(a), after: range(b) });
    if (a.busca !== b.busca) out.push({ title: `${label} · qué busca`, before: a.busca, after: b.busca });
  }
  for (const d of WEEKDAYS) {
    const a = before.vendedores[d] ?? null;
    const b = after.vendedores[d] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push({ title: `Horario de los vendedores · ${WEEKDAY_LABEL[d]}`, before: a ? range(a) : "no trabaja", after: b ? range(b) : "no trabaja" });
  }
  return out;
}
