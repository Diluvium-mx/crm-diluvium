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
    doors: ["saludo", "saludo", "proteccion"],
    avisoVendedor: false,
  },
  pago_pendiente: {
    label: "Pago pendiente",
    objetivo: "El comprobante, o resolver lo que lo frena (forma de pago, tarjeta, fecha de entrega)",
    slot: { from: "10:00", to: "11:00" },
    total: 3,
    doors: ["saludo", "saludo", "proteccion"],
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
