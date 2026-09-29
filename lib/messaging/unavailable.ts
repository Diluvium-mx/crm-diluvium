// Mensaje "no disponible" (visto en el número oficial, 27-sep-2026): con
// coexistencia, Meta a veces avisa primero que un entrante no está disponible
// (código 131060, sin contenido) y un instante después manda el mensaje REAL
// con el MISMO wamid. Zernio reenvía ambos tal cual: el aviso llega con texto
// "[Unsupported message]" y `metadata.unsupported` ({ code, title, details }).
// El índice único por wamid descartaba el segundo como duplicado; ahora el
// aviso se COMPLETA con el contenido real (lib/messaging/ingest.ts).
//
// Doble verificación (29-sep-2026, caso "SDA"). Medido en producción (349 primeros
// mensajes): el 4.9 % llega como aviso 131060, SOLO en el primer mensaje de un
// contacto nuevo. De esos avisos, el real llega con el MISMO wamid (0.1–2.3 s), o
// con OTRO wamid a 0–5 s (el aviso queda como sombra encima del real), o nunca
// (1.4 % de los primeros mensajes; ni Zernio tiene el texto). Por eso el aviso de
// un PRIMER mensaje nace "verificando" (no se ve como burbuja ni lo toma el Agente
// IA) y a los VERIFY_AFTER_MS se decide (lib/messaging/unavailable-check.ts):
// - llegó el real aparte → "sombra": se oculta y se descuenta su no leído;
// - Zernio sí tiene el contenido → se completa la fila como hoy;
// - no llegó nada → "sin_contenido": tarjeta para el vendedor y el Agente IA
//   contesta con el texto fijo del dueño (UNAVAILABLE_REPLY_TEXT).
// Estrictamente el caso SDA: código 131060 en el primer entrante del chat. Otro
// aviso (131051, o un 131060 a mitad del chat) sigue como antes.
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/** Código de Meta del aviso "no disponible" (primer mensaje a un número en coexistencia). */
export const UNAVAILABLE_CODE = 131060;
/** Llave en messages.metadata del estado de la doble verificación. */
export const NO_DISPONIBLE_KEY = "noDisponible";
export type NoDisponibleEstado = "verificando" | "sombra" | "sin_contenido";

/**
 * Espera antes de decidir. Medido en producción (27–29 sep, 20 avisos): de los 15 reales
 * que sí llegaron, el más tardío llegó a los 4.9 s (mismo wamid: 0.1–2.3 s; otro wamid:
 * 0.6–4.9 s) y ninguno de los 5 perdidos llegó después (días). 60 s = más de 12 veces lo
 * más tardío. Solo retrasa la respuesta cuando de verdad no llegó nada: el real, cuando
 * llega, despierta al Agente IA en ese momento sin esperar esto (dueño, 29-sep-2026).
 */
export const VERIFY_AFTER_MS = 60_000;
/** Ventana (según la hora de WhatsApp) en la que otro entrante es el real de la sombra: medido 0–3 s; 19 s ya fue otro mensaje. */
export const SHADOW_BEFORE_MS = 5_000;
export const SHADOW_AFTER_MS = 10_000;
/** Si Zernio no responde, no se deja al cliente sin respuesta: pasado esto se confirma "sin contenido". */
export const VERIFY_GIVE_UP_MS = 3 * 60_000;

/** Tarjeta del chat y vista previa de la lista (texto aprobado por el dueño, 29-sep-2026). */
export const NOTICE_CARD_TEXT = "El cliente escribió, pero WhatsApp no pasó el mensaje al CRM. Míralo en el celular.";
/** Mientras se verifica (hasta VERIFY_AFTER_MS). */
export const NOTICE_RECEIVING_TEXT = "Recibiendo mensaje…";
/** Respuesta del Agente IA, EXACTA como la escribió el dueño (29-sep-2026). */
export const UNAVAILABLE_REPLY_TEXT =
  "¡Hola! Gracias por escribirnos 😊 Tuvimos una falla técnica y su mensaje no nos llegó. ¿Nos ayudas escribiéndolo de nuevo para seguir con su atención?";
/**
 * ¿Se completó con el contenido real DESPUÉS de confirmarse sin contenido (el Agente IA
 * ya pudo mandar el texto fijo)? Entonces ese contenido cuenta como nuevo para el Agente
 * IA: lo contesta según lo que dice (lib/ai/runtime/context.ts, pendingInbound).
 */
export function completedAfterConfirmation(metadata: Metadata): boolean {
  return asRecord(metadata?.noDisponibleAntes)?.verificacion === "sin_contenido";
}

/** La misma regla en SQL: hora en que "llegó" para el Agente IA (la del completado), o null. */
export function lateContentAtSql(metadata: AnyColumn | SQL): SQL {
  return sql`case when ${metadata}->'noDisponibleAntes'->>'verificacion' = 'sin_contenido'
    then ((${metadata}->'noDisponibleAntes'->>'completadoEn')::timestamptz at time zone 'UTC') end`;
}

/** Cómo lo leen el Agente IA y el lector en el historial (en vez del texto crudo). */
export const UNAVAILABLE_HISTORY_NOTE =
  "[Primer mensaje del cliente: no llegó por una falla técnica de WhatsApp; no se sabe qué decía]";

type Metadata = Record<string, unknown> | null | undefined;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** ¿Es el aviso vacío de Meta (metadata.unsupported), no un mensaje con contenido? */
export function isUnavailableNotice(metadata: Metadata): boolean {
  return asRecord(metadata?.unsupported) !== null;
}

/** Código de Meta del aviso (131060, 131051…), o null si no es aviso. */
export function unavailableCode(metadata: Metadata): number | null {
  const code = asRecord(metadata?.unsupported)?.code;
  return typeof code === "number" ? code : typeof code === "string" && /^\d+$/.test(code) ? Number(code) : null;
}

/** Estado de la doble verificación, o null si el mensaje no la tiene. */
export function noDisponibleEstado(metadata: Metadata): NoDisponibleEstado | null {
  const estado = asRecord(metadata?.[NO_DISPONIBLE_KEY])?.estado;
  return estado === "verificando" || estado === "sombra" || estado === "sin_contenido" ? estado : null;
}

/** Aviso que NO se muestra ni se atiende todavía ("verificando") o nunca ("sombra"). */
export function isHiddenNotice(metadata: Metadata): boolean {
  const estado = noDisponibleEstado(metadata);
  return estado === "verificando" || estado === "sombra";
}

/**
 * La misma regla en SQL. `metadata` = la columna (p. ej. `messages.metadata`) o
 * `sql.raw("m.metadata")` en consultas con alias. Metadata nula → no oculto.
 */
export function hiddenNoticeSql(metadata: AnyColumn | SQL): SQL {
  return sql`coalesce(${metadata}->${NO_DISPONIBLE_KEY}->>'estado', '') in ('verificando', 'sombra')`;
}

/** Solo la sombra (el vendedor SÍ ve "Recibiendo mensaje…" mientras se verifica). */
export function shadowNoticeSql(metadata: AnyColumn | SQL): SQL {
  return sql`coalesce(${metadata}->${NO_DISPONIBLE_KEY}->>'estado', '') = 'sombra'`;
}

/** Texto visible (hilo y vista previa) de un aviso en verificación o confirmado; null = mensaje normal. */
export function noticeDisplayText(metadata: Metadata): string | null {
  const estado = noDisponibleEstado(metadata);
  return estado === "verificando" ? NOTICE_RECEIVING_TEXT : estado === "sin_contenido" ? NOTICE_CARD_TEXT : null;
}

/** Metadata con la que nace el aviso a verificar. */
export function verifyingMetadata(metadata: Metadata, at: Date): Record<string, unknown> {
  return { ...(metadata ?? {}), [NO_DISPONIBLE_KEY]: { estado: "verificando", desde: at.toISOString() } };
}

/** Metadata con el resultado de la verificación ("sombra" lleva el id del mensaje real). */
export function resolvedMetadata(
  metadata: Metadata,
  estado: Exclude<NoDisponibleEstado, "verificando">,
  at: Date,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const previous = asRecord(metadata?.[NO_DISPONIBLE_KEY]) ?? {};
  return { ...(metadata ?? {}), [NO_DISPONIBLE_KEY]: { ...previous, ...extra, estado, verificadoEn: at.toISOString() } };
}

/**
 * Metadata del mensaje ya completado: se conserva lo que ya tenía (p. ej. el
 * respaldo del anuncio), se suma la del mensaje real y la marca "no disponible"
 * se guarda aparte con la hora en que se completó (ya no cuenta como aviso). El
 * estado de la verificación (si la hubo) queda dentro de esa marca.
 */
export function completedMetadata(
  previous: Metadata,
  incoming: Metadata,
  completedAt: Date,
): Record<string, unknown> {
  const { unsupported, [NO_DISPONIBLE_KEY]: verification, ...rest } = previous ?? {};
  const notice = asRecord(unsupported) ?? {};
  const estado = asRecord(verification)?.estado;
  return {
    ...rest,
    ...(incoming ?? {}),
    noDisponibleAntes: {
      ...notice,
      ...(typeof estado === "string" ? { verificacion: estado } : {}),
      completadoEn: completedAt.toISOString(),
    },
  };
}
