// La FICHA de seguimiento que devuelve el lector (docs/seguimientos.md §5), en la misma
// herramienta `actualizar_contacto` y solo cuando el último mensaje del chat es nuestro. PURO:
// validación campo por campo (un dato raro no tira los demás) y el cruce del caso con los
// datos duros del CRM (el modelo propone, el código confirma).
import { z } from "zod";
import { FOLLOW_UP_CASES, isFollowUpCase, MAX_ASKED_DAYS, type FollowUpCase } from "./cases";
import { addDays, formatLocalDate, isHhmm, localParts, parseLocalDate } from "./time";

export const MAX_FICHA_LINE = 240;
export const MAX_BORRADOR = 600;

export type FollowUpFicha = {
  caso: FollowUpCase | null;
  pendiente: string | null;
  siguientePaso: string | null;
  valeLaPena: boolean | null;
  motivo: string | null;
  fechaPedida: string | null;
  horaPedida: string | null;
  borrador: string | null;
  /** En "pidió fecha": el asunto que quedó pendiente (da la hora si solo dijo el día). */
  casoDeFondo: FollowUpCase | null;
  /** Plantilla que mejor encaja para el 2.º y el 3.er intento (la valida el CRM). */
  plantilla2: string | null;
  plantilla3: string | null;
};

/** Casos que pueden ser "el asunto" de una fecha pedida. */
export const FONDO_CASES = FOLLOW_UP_CASES.filter((c) => c !== "no_seguir" && c !== "pidio_fecha");

/** El campo `seguimiento` de `actualizar_contacto` (solo cuando el último mensaje es nuestro). */
export function fichaSchema() {
  const sin = " (null si no aplica)";
  return z
    .object({
      caso: z.enum(FOLLOW_UP_CASES).describe("Qué quedó pendiente: el PRIMERO de la lista que aplique"),
      pendiente: z.string().nullable().optional().describe("En una línea, lo que quedó abierto"),
      siguiente_paso: z.string().nullable().optional().describe("En una línea, lo que lo acerca a comprar"),
      vale_la_pena: z.boolean().nullable().optional().describe("false solo si no hay que escribirle (no_seguir)"),
      motivo: z.string().nullable().optional().describe(`Por qué no vale la pena${sin}`),
      fecha_pedida: z.string().nullable().optional().describe(`Pidió fecha: AAAA-MM-DD en su calendario${sin}`),
      hora_pedida: z.string().nullable().optional().describe(`Pidió hora: HH:MM en su hora${sin}`),
      borrador: z.string().nullable().optional().describe("El mensaje que se le mandaría, sin saludo al principio"),
      caso_de_fondo: z
        .enum(FONDO_CASES as [FollowUpCase, ...FollowUpCase[]])
        .nullable()
        .optional()
        .describe(`Solo en pidio_fecha: qué quedó pendiente (faltan_medidas, pago_pendiente…)${sin}`),
      plantilla_2: z.string().nullable().optional().describe(`Nombre de la plantilla de la lista para el 2.º intento${sin}`),
      plantilla_3: z.string().nullable().optional().describe(`Nombre de la plantilla de la lista para el 3.er intento${sin}`),
    })
    .describe("Seguimiento: qué le escribiríamos si no contesta");
}

function line(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function block(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Valida la ficha. `today` = fecha del cliente al leer: la fecha pedida debe ser de hoy en
 * adelante y a menos de 60 días; si no, se descarta (con su motivo en `ignored`).
 */
export function parseFicha(raw: unknown, today: { zone: string; now: Date }, ignored: string[]): FollowUpFicha | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const caso = isFollowUpCase(r.caso) ? r.caso : null;
  if (r.caso != null && !caso) ignored.push(`seguimiento.caso: ${String(r.caso)} no existe`);
  let fechaPedida: string | null = null;
  if (typeof r.fecha_pedida === "string" && r.fecha_pedida.trim()) {
    const d = parseLocalDate(r.fecha_pedida.trim());
    const p = localParts(today.now, today.zone);
    const hoy = formatLocalDate(p);
    const limite = formatLocalDate(addDays(p, MAX_ASKED_DAYS));
    if (!d) ignored.push(`seguimiento.fecha_pedida: ${r.fecha_pedida} no es una fecha`);
    else if (formatLocalDate(d) < hoy) ignored.push(`seguimiento.fecha_pedida: ${r.fecha_pedida} ya pasó`);
    else if (formatLocalDate(d) > limite) ignored.push(`seguimiento.fecha_pedida: ${r.fecha_pedida} a más de ${MAX_ASKED_DAYS} días`);
    else fechaPedida = formatLocalDate(d);
  }
  let horaPedida: string | null = null;
  if (typeof r.hora_pedida === "string" && r.hora_pedida.trim()) {
    const h = r.hora_pedida.trim().padStart(5, "0");
    if (isHhmm(h)) horaPedida = h;
    else ignored.push(`seguimiento.hora_pedida: ${r.hora_pedida} no es una hora`);
  }
  const casoDeFondo = isFollowUpCase(r.caso_de_fondo) && (FONDO_CASES as readonly string[]).includes(r.caso_de_fondo) ? r.caso_de_fondo : null;
  const name = (v: unknown) => (typeof v === "string" && /^[a-z0-9_]{1,64}$/.test(v.trim()) ? v.trim() : null);
  return {
    caso,
    casoDeFondo: caso === "pidio_fecha" ? casoDeFondo : null,
    plantilla2: name(r.plantilla_2),
    plantilla3: name(r.plantilla_3),
    pendiente: line(r.pendiente, MAX_FICHA_LINE),
    siguientePaso: line(r.siguiente_paso, MAX_FICHA_LINE),
    valeLaPena: typeof r.vale_la_pena === "boolean" ? r.vale_la_pena : null,
    motivo: line(r.motivo, MAX_FICHA_LINE),
    fechaPedida,
    horaPedida: fechaPedida ? horaPedida : null,
    borrador: block(r.borrador, MAX_BORRADOR),
  };
}

// ── Cruce con los datos duros del CRM ────────────────────────────────────────
export type HardSignals = {
  /** Aviso abierto de "pasar a un asesor" / "el cliente pide una persona" sin respuesta humana después. */
  asesorPendiente: boolean;
  /** Papel de la etapa del contacto en el Embudo. */
  stageRole: "entrada" | "cerca_compra" | "venta_cerrada" | null;
  monto: number | null;
  pago: number | null;
  /** El Detalle tiene al menos un ancho de entrada. */
  tieneMedidas: boolean;
};

export type FinalCase = { caso: FollowUpCase; ajuste: string | null };

const LOWER_THAN_QUOTE: readonly FollowUpCase[] = ["faltan_medidas", "precio_sin_respuesta", "solo_informacion", "sin_punto_claro"];

/**
 * Caso final, en el orden de prioridad de la tabla (§6). `ajuste` explica cuando el código
 * cambió lo que propuso el modelo (va al registro de la lectura).
 */
export function finalCase(ficha: FollowUpFicha | null, hard: HardSignals): FinalCase {
  const model = ficha?.caso ?? null;
  const pick = (caso: FollowUpCase, why: string): FinalCase => ({ caso, ajuste: model === caso ? null : `${model ?? "sin caso"} → ${caso} (${why})` });
  const pagado = hard.monto !== null && hard.pago !== null && hard.pago >= hard.monto;
  if (hard.stageRole === "venta_cerrada" || pagado) return pick("no_seguir", "ya compró");
  if (model === "no_seguir" || ficha?.valeLaPena === false) return { caso: "no_seguir", ajuste: null };
  // El aviso amarillo de asesor es la prueba dura; sin aviso (p. ej. el Agente IA estaba en
  // pausa cuando pidió una persona) vale lo que leyó el modelo.
  if (hard.asesorPendiente || model === "asesor_sin_respuesta") return pick("asesor_sin_respuesta", "aviso de asesor sin respuesta");
  if (model === "pidio_fecha" && ficha?.fechaPedida) return { caso: "pidio_fecha", ajuste: null };
  if (model === "pago_pendiente" || hard.stageRole === "cerca_compra") return pick("pago_pendiente", "etapa Cerca de compra sin el pago completo");
  if (model === "objecion") return { caso: "objecion", ajuste: null };
  if (model === "cotizacion_sin_respuesta") return { caso: model, ajuste: null };
  if (hard.tieneMedidas && hard.monto !== null && (model === null || LOWER_THAN_QUOTE.includes(model) || model === "pidio_fecha")) {
    return pick("cotizacion_sin_respuesta", "el Detalle tiene medidas y monto");
  }
  if (model && model !== "pidio_fecha") return { caso: model, ajuste: null };
  return pick("sin_punto_claro", model ? "pidió fecha pero no quedó cuál" : "el modelo no dio caso");
}
