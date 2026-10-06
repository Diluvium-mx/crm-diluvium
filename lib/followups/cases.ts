// Tabla de casos de los seguimientos (docs/seguimientos.md §6, aprobada por el dueño el 2-oct-2026).
// PURO y seguro para el cliente. El orden de FOLLOW_UP_CASES es la prioridad: si dos casos
// aplican, gana el primero.
//
// Hora de cada caso (§6.2), en la hora local del cliente (zona según su lada):
//   pago 10:00 · objeción y medidas 19:00–20:30 · precio e información 19:00–21:00 ·
//   cotización y sin punto claro 18:00–20:00 · pidió fecha a su hora (solo el día: 11:00) ·
//   asesor 2 h después y los siguientes a las 10:00.
// Puertas (ventana cerrada): "saludo" = hola_buenos_dias antes de las 12:00 y
// hola_buenas_tardes después; "proteccion" = seguimiento_proteccion.

export const FOLLOW_UP_CASES = [
  "no_seguir",
  "asesor_sin_respuesta",
  "pidio_fecha",
  "pago_pendiente",
  "objecion",
  "cotizacion_sin_respuesta",
  "faltan_medidas",
  "precio_sin_respuesta",
  "solo_informacion",
  "sin_punto_claro",
] as const;
export type FollowUpCase = (typeof FOLLOW_UP_CASES)[number];

export type DoorKind = "saludo" | "proteccion";
export type HourSlot = { from: string; to: string };

export type CaseRule = {
  label: string;
  /** Qué busca el mensaje (§6). */
  objetivo: string;
  /** Franja del caso (hora local del cliente). null = no tiene (no_seguir). */
  slot: HourSlot | null;
  /** Cuántos intentos tiene (0 = nunca). */
  total: number;
  /** Puerta de cada intento con la ventana cerrada: [1.º, 2.º, 3.º]. */
  doors: readonly DoorKind[];
  /** Al terminar sin respuesta deja aviso al vendedor (además de frío). */
  avisoVendedor: boolean;
};

export const CASE_RULES: Readonly<Record<FollowUpCase, CaseRule>> = {
  no_seguir: { label: "No seguir", objetivo: "—", slot: null, total: 0, doors: [], avisoVendedor: false },
  asesor_sin_respuesta: {
    label: "Asesor sin respuesta",
    objetivo: "Que no se quede colgado y lo atienda un vendedor",
    slot: { from: "10:00", to: "11:00" },
    total: 2,
    doors: ["saludo", "saludo"],
    avisoVendedor: true,
  },
  pidio_fecha: {
    label: "Pidió que le escribieran",
    objetivo: "Retomar justo como quedaron",
    slot: { from: "11:00", to: "12:00" },
    total: 3,
    doors: ["saludo", "saludo", "saludo"],
    avisoVendedor: false,
  },
  pago_pendiente: {
    label: "Pago pendiente",
    objetivo: "El comprobante, o resolver lo que lo frena (forma de pago, tarjeta, fecha de entrega)",
    slot: { from: "10:00", to: "11:00" },
    total: 3,
    doors: ["saludo", "saludo", "saludo"],
    avisoVendedor: true,
  },
  objecion: {
    label: "Lo va a pensar u objeción",
    objetivo: "Responder esa duda u objeción con algo útil",
    slot: { from: "19:00", to: "20:30" },
    total: 3,
    doors: ["saludo", "proteccion", "saludo"],
    avisoVendedor: false,
  },
  cotizacion_sin_respuesta: {
    label: "Cotización sin respuesta",
    objetivo: "Resolver la duda que lo frena y ofrecer los datos de pago",
    slot: { from: "18:00", to: "20:00" },
    total: 3,
    doors: ["saludo", "proteccion", "saludo"],
    avisoVendedor: false,
  },
  faltan_medidas: {
    label: "Faltan medidas",
    objetivo: "Pedir exactamente el dato que falta, con cómo medir, ahora que está en casa",
    slot: { from: "19:00", to: "20:30" },
    total: 2,
    doors: ["saludo", "saludo"],
    avisoVendedor: false,
  },
  precio_sin_respuesta: {
    label: "Precio sin respuesta",
    objetivo: "Saber dónde lo usaría y si se le mete el agua",
    slot: { from: "19:00", to: "21:00" },
    total: 2,
    doors: ["saludo", "saludo"],
    avisoVendedor: false,
  },
  solo_informacion: {
    label: "Solo información",
    objetivo: "Saber dónde lo usaría y si se le mete el agua",
    slot: { from: "19:00", to: "21:00" },
    total: 2,
    doors: ["saludo", "saludo"],
    avisoVendedor: false,
  },
  sin_punto_claro: {
    label: "Sin punto claro",
    objetivo: "Reenganchar con una pregunta sobre su caso",
    slot: { from: "18:00", to: "20:00" },
    total: 2,
    doors: ["saludo", "saludo"],
    avisoVendedor: false,
  },
};

export function isFollowUpCase(value: unknown): value is FollowUpCase {
  return typeof value === "string" && (FOLLOW_UP_CASES as readonly string[]).includes(value);
}

/** Horario permitido (hora del cliente, todos los días): 7:00 a 21:00. */
export const ALLOWED_FROM = "07:00";
export const ALLOWED_TO = "21:00";
/** Con plantilla, nunca después de las 19:00 (una plantilla de noche es rara). */
export const TEMPLATE_LATEST = "19:00";
/** En los casos de noche, la plantilla sale a esta hora. */
export const TEMPLATE_EVENING = "18:00";
/** El 1.er intento con texto, nunca antes de 8 h de silencio. */
export const MIN_SILENCE_MS = 8 * 60 * 60_000;
/** ...y al menos 1 h antes de que cierre la ventana de 24 h. */
export const WINDOW_MARGIN_MS = 60 * 60_000;
/** Dos plantillas de seguimiento al mismo contacto: al menos 7 días entre sí. */
export const TEMPLATE_SPACING_DAYS = 7;
/** Asesor sin respuesta: el 1.er intento, 2 h después. */
export const ASESOR_DELAY_MS = 2 * 60 * 60_000;
/** "Estoy ocupado" / "al rato" sin hora: 3 h después. */
export const OCUPADO_DELAY_MS = 3 * 60 * 60_000;
/** Tras el último intento, cuánto se espera respuesta antes de darlo por frío. */
export const WAIT_AFTER_LAST_MS = 72 * 60 * 60_000;
/** Fecha pedida: más allá de esto el contexto ya cambió. */
export const MAX_ASKED_DAYS = 60;

export const TEMPLATE_BY_DOOR = {
  proteccion: "seguimiento_proteccion",
  saludoManana: "hola_buenos_dias",
  saludoTarde: "hola_buenas_tardes",
} as const;

/** "1.º de 3". */
export function attemptLabel(intento: number, total: number): string {
  return `${intento}.º de ${total}`;
}

// ── Plantillas propias de cada caso (aprobadas por el dueño el 3-oct-2026; dadas de alta en Meta ese día) ──
// Salen en el 1.er intento forzado a plantilla y en el 2.º, SOLO cuando Meta ya las aprobó (en la tabla
// `templates` del CRM); mientras tanto, o si se rechazan, sale la puerta de respaldo (🚪 / 📄).
export const CASE_TEMPLATE: Readonly<Partial<Record<FollowUpCase, string>>> = {
  precio_sin_respuesta: "seg_precio",
  // seg_informacion vuelve a preguntar si se le mete el agua, que el workflow «Información» ya
  // preguntó: va seg_info_duda (aprobada por el dueño el 3-oct-2026); mientras Meta no la aprueba,
  // seg_precio. seg_informacion solo si el lector la elige (nunca se preguntó lo del agua).
  solo_informacion: "seg_info_duda",
  cotizacion_sin_respuesta: "seg_valorar",
  pago_pendiente: "seg_valorar",
  pidio_fecha: "seg_valorar",
  faltan_medidas: "seg_medidas",
  asesor_sin_respuesta: "seg_asesor",
  objecion: "seg_objecion",
};

/**
 * Plantillas cuyo {{1}} NO es el nombre sino CUÁNDO nos escribió el cliente ("el día de ayer",
 * "anoche"…; lib/followups/time-phrase.ts). Las demás siguen con el primer nombre en {{1}}.
 */
export const TIME_PHRASE_TEMPLATES: ReadonlySet<string> = new Set(["seg_precio", "seg_informacion", "seg_info_duda", "seg_valorar", "seg_medidas"]);

/**
 * Lo mismo, pero SOLO para el selector 📄 (mandar o programar a mano): también las `daniel_*`,
 * cuyo {{1}} es la misma frase de tiempo. Conjunto aparte a propósito: TIME_PHRASE_TEMPLATES lo usan
 * los seguimientos automáticos (dispatch.ts, view.ts) y esos NO mandan las `daniel_*`.
 */
export const PICKER_TIME_PHRASE_TEMPLATES: ReadonlySet<string> = new Set([
  ...TIME_PHRASE_TEMPLATES,
  "daniel_precio",
  "daniel_informacion",
  "daniel_info_duda",
  "daniel_valorar",
  "daniel_medidas",
  "daniel_asesor",
  "daniel_objecion",
]);

/** Si la plantilla del caso todavía no está aprobada: otra propia antes que la puerta. */
export const CASE_TEMPLATE_BACKUP: Readonly<Partial<Record<FollowUpCase, string>>> = {
  solo_informacion: "seg_precio",
};

/**
 * Plantillas que el lector puede elegir para el 2.º y 3.er intento según cómo quedó el chat
 * (decisión del dueño, 3-oct-2026: la que mejor encaje y nunca una pregunta ya hecha). Los dos
 * saludos son la misma puerta: el CRM pone el de la mañana o el de la tarde según la hora.
 */
export const FOLLOW_UP_TEMPLATES: readonly string[] = [
  TEMPLATE_BY_DOOR.saludoManana,
  TEMPLATE_BY_DOOR.saludoTarde,
  TEMPLATE_BY_DOOR.proteccion,
  "seg_precio",
  "seg_informacion",
  "seg_info_duda",
  "seg_valorar",
  "seg_medidas",
  "seg_asesor",
  "seg_objecion",
];
const SALUDOS: ReadonlySet<string> = new Set([TEMPLATE_BY_DOOR.saludoManana, TEMPLATE_BY_DOOR.saludoTarde]);

export type TemplatePicks = { plantilla2?: string | null; plantilla3?: string | null };

/**
 * Plantilla que sale en ese intento. `fallback` = la de la puerta (saludo por hora o
 * seguimiento_proteccion). Orden: la que eligió el lector para ese intento (si Meta ya la aprobó
 * y no es la misma del intento anterior); si no, en el 1.º y 2.º, la del caso si ya está aprobada;
 * si no, la de la puerta. Un saludo elegido por el lector sale con el de la hora (`fallback`
 * cuando la puerta es saludo).
 */
export function templateForAttempt(
  caso: FollowUpCase,
  intento: number,
  fallback: string | null,
  approved: ReadonlySet<string>,
  picks: TemplatePicks = {},
  previous: string | null = null,
): string | null {
  if (fallback === null) return null;
  const pick = intento === 2 ? picks.plantilla2 : intento >= 3 ? picks.plantilla3 : null;
  const same = (a: string | null, b: string | null) => a !== null && b !== null && (a === b || (SALUDOS.has(a) && SALUDOS.has(b)));
  if (pick && FOLLOW_UP_TEMPLATES.includes(pick) && (SALUDOS.has(pick) || approved.has(pick))) {
    const chosen = SALUDOS.has(pick) ? (SALUDOS.has(fallback) ? fallback : pick) : pick;
    if (!same(chosen, previous)) return chosen;
  }
  if (intento > 2) return fallback;
  for (const own of [CASE_TEMPLATE[caso], CASE_TEMPLATE_BACKUP[caso]]) {
    if (own && approved.has(own) && !same(own, previous)) return own;
  }
  return fallback;
}

/**
 * Caso con el que se calcula la HORA: en "pidió fecha" sin hora, la del asunto que quedó
 * pendiente (medidas en la noche, pago en la mañana…; decisión del dueño, 3-oct-2026).
 */
export function timingCase(caso: Exclude<FollowUpCase, "no_seguir">, fondo: FollowUpCase | null | undefined): Exclude<FollowUpCase, "no_seguir"> {
  if (caso !== "pidio_fecha" || !fondo || fondo === "no_seguir" || fondo === "pidio_fecha") return caso;
  return fondo;
}
