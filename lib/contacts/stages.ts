// Etapas del Embudo (PURO, sin BD). Desde "Columnas del Embudo" (26-sep-2026) las
// etapas son filas de `funnel_stages` por organización (clave estable, nombre, orden,
// color, papel, regla del bot y modelo), no un enum fijo. Aquí viven los tipos, los
// valores por defecto (las 5 de siempre) y las comparaciones: orden, "solo hacia
// adelante", papel, clave a partir del nombre y validación. La escritura vive en
// lib/contacts/funnel-stages.ts (tabla) y lib/contacts/stage.ts (mover un contacto).
export const STAGE_ROLES = ["entrada", "cerca_compra", "venta_cerrada"] as const;
export type StageRole = (typeof STAGE_ROLES)[number];

// Lo que significa cada papel para el CRM (cada uno vive en UNA etapa por organización).
export const STAGE_ROLE_LABELS: Record<StageRole, string> = {
  entrada: "Entrada",
  cerca_compra: "Cerca de compra",
  venta_cerrada: "Venta cerrada",
};
export const STAGE_ROLE_HINTS: Record<StageRole, string> = {
  entrada: "Donde llegan los contactos nuevos.",
  cerca_compra: "A donde mueven los datos bancarios y /banco.",
  venta_cerrada: "A donde mueve un comprobante que cuadra; lo que Anuncios cuenta como \"Compraron\".",
};

export type ModelSlot = 1 | 2;

export type FunnelStage = {
  id: string;
  key: string;
  name: string;
  position: number;
  color: string;
  role: StageRole | null;
  /** Cuándo debe mover el agente al contacto aquí (texto libre; vacío = sin regla). */
  botRule: string;
  modelSlot: ModelSlot;
};

export type StageChangedBy = "vendedor" | "agente" | "sistema";

export const MIN_STAGES = 3;
export const MAX_STAGES = 10;
export const MAX_STAGE_NAME = 40;
export const MAX_STAGE_RULE = 1000;
export const STAGE_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;
export const STAGE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Paleta para columnas nuevas (naranja de marca reservado a acciones y alertas).
export const STAGE_COLORS = ["#64748B", "#0A559A", "#0891B2", "#7C3AED", "#059669", "#DB2777", "#B45309", "#4F46E5", "#0F766E", "#6B7280"] as const;

// Las 5 etapas de siempre (mismas claves y nombres que el enum viejo `contact_stage`),
// iguales a las que siembra la migración 0041 y el trigger `funnel_stages_seed_org`.
export const DEFAULT_STAGES: readonly Omit<FunnelStage, "id">[] = [
  { key: "inbox", name: "Inbox", position: 1, color: "#64748B", role: "entrada", botRule: "", modelSlot: 1 },
  { key: "prospecto", name: "Prospecto", position: 2, color: "#0A559A", role: null, botRule: "Cuando el cliente contesta por primera vez.", modelSlot: 1 },
  { key: "interesado", name: "Interesado", position: 3, color: "#0891B2", role: null, botRule: "Cuando pregunta precio o da medidas.", modelSlot: 1 },
  { key: "cerca_compra", name: "Cerca de compra", position: 4, color: "#7C3AED", role: "cerca_compra", botRule: "Cuando recibe los datos bancarios, o cuando confirmas un anticipo.", modelSlot: 2 },
  { key: "compra", name: "Compra", position: 5, color: "#059669", role: "venta_cerrada", botRule: "Cuando confirmas un comprobante válido por el total (o por lo que faltaba).", modelSlot: 2 },
];
export const DEFAULT_STAGE_KEYS = DEFAULT_STAGES.map((s) => s.key);

/** Las etapas por defecto con ids sintéticos (pruebas y valores de respaldo). */
export function defaultStages(): FunnelStage[] {
  return DEFAULT_STAGES.map((s) => ({ ...s, id: `default_${s.key}` }));
}

export function sortStages<T extends { position: number; key: string }>(stages: readonly T[]): T[] {
  return [...stages].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}

export function stageByKey<T extends { key: string }>(stages: readonly T[], key: string | null | undefined): T | undefined {
  return key ? stages.find((s) => s.key === key) : undefined;
}

export function stageForRole<T extends { role: StageRole | null }>(stages: readonly T[], role: StageRole): T | undefined {
  return stages.find((s) => s.role === role);
}

/** Clave de la etapa con ese papel, o null si (por un dato roto) ninguna lo tiene. */
export function roleKey(stages: readonly FunnelStage[], role: StageRole): string | null {
  return stageForRole(stages, role)?.key ?? null;
}

/** Nombre para mostrar; si la clave ya no existe, la clave misma. */
export function stageLabel(stages: readonly { key: string; name: string }[], key: string): string {
  return stageByKey(stages, key)?.name ?? key;
}

export function isStageKey(stages: readonly { key: string }[], v: unknown): v is string {
  return typeof v === "string" && stages.some((s) => s.key === v);
}

// ¿`to` está más adelante que `from` en el orden actual? Una clave desconocida nunca
// es "adelante" (el agente no puede mover a una etapa que ya no existe).
export function isForward(stages: readonly FunnelStage[], from: string, to: string): boolean {
  const a = stageByKey(stages, from);
  const b = stageByKey(stages, to);
  if (!a || !b) return false;
  return b.position > a.position;
}

/** La más adelantada de varias claves (varias `mover_etapa` en una respuesta). */
export function furthestStage(stages: readonly FunnelStage[], keys: readonly string[]): string | null {
  let best: FunnelStage | null = null;
  for (const k of keys) {
    const s = stageByKey(stages, k);
    if (s && (!best || s.position > best.position)) best = s;
  }
  return best?.key ?? null;
}

// Clave estable a partir del nombre ("Cerca de compra" → "cerca_de_compra"); si ya
// existe, sufijo numérico. Nunca cambia después aunque se renombre la etapa.
export function stageKeyFromName(name: string, existingKeys: readonly string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "etapa";
  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
}

/** Nombre limpio o el motivo por el que no sirve. */
export function normalizeStageName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "El nombre de la etapa no puede quedar vacío." };
  if (name.length > MAX_STAGE_NAME) return { ok: false, error: `El nombre no puede pasar de ${MAX_STAGE_NAME} caracteres.` };
  return { ok: true, name };
}

/**
 * Comprobación de un juego completo de etapas (lo que el editor y la BD exigen):
 * entre 3 y 10, claves y nombres únicos, cada papel en exactamente una etapa, y el
 * ORDEN de los papeles: la de Entrada es la primera columna y "Cerca de compra" va
 * antes que "Venta cerrada" (si no, "solo hacia adelante" dejaría que /banco regrese a
 * un cliente de Venta cerrada, o que los contactos nuevos nazcan en una columna desde
 * la que el bot no puede avanzar a las de antes).
 */
export function validateStageSet(stages: readonly Pick<FunnelStage, "key" | "name" | "role" | "position">[]): string[] {
  const errors: string[] = [];
  if (stages.length < MIN_STAGES) errors.push(`El Embudo necesita al menos ${MIN_STAGES} etapas.`);
  if (stages.length > MAX_STAGES) errors.push(`El Embudo no puede tener más de ${MAX_STAGES} etapas.`);
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const s of stages) {
    if (keys.has(s.key)) errors.push(`Clave repetida: ${s.key}.`);
    keys.add(s.key);
    const n = s.name.trim().toLocaleLowerCase("es-MX");
    if (names.has(n)) errors.push(`Ya hay una etapa llamada "${s.name.trim()}".`);
    names.add(n);
  }
  for (const role of STAGE_ROLES) {
    const count = stages.filter((s) => s.role === role).length;
    if (count !== 1) errors.push(`El papel "${STAGE_ROLE_LABELS[role]}" debe estar en exactamente una etapa (hay ${count}).`);
  }
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const at = (role: StageRole) => ordered.findIndex((s) => s.role === role);
  if (at("entrada") > 0) errors.push(`La etapa con el papel "${STAGE_ROLE_LABELS.entrada}" debe ser la primera columna (ahí llegan los contactos nuevos).`);
  if (at("cerca_compra") >= 0 && at("venta_cerrada") >= 0 && at("cerca_compra") > at("venta_cerrada")) {
    errors.push(`La etapa con el papel "${STAGE_ROLE_LABELS.cerca_compra}" debe ir antes que la de "${STAGE_ROLE_LABELS.venta_cerrada}" (el bot y /banco solo avanzan).`);
  }
  return errors;
}

// Texto que el CRM agrega a las instrucciones del agente en cada respuesta: las etapas
// vigentes en orden, con su clave (la que acepta mover_etapa) y su regla. Cambiarlas en
// el editor cambia esto en la siguiente respuesta, sin tocar el Goal.
export function stagesInstructions(stages: readonly FunnelStage[]): string {
  const ordered = sortStages(stages);
  const lines = ordered.map((s, i) => {
    const rule = s.botRule.trim();
    const papel = s.role === "entrada" ? " (aquí llegan los contactos nuevos)" : "";
    return `${i + 1}. ${s.key} — "${s.name}"${papel}: ${rule || "sin regla: no muevas al contacto aquí por tu cuenta"}`;
  });
  return [
    "ETAPAS DEL EMBUDO (las define el CRM)",
    "Avanza al cliente de etapa con la acción mover_etapa (usa la clave, no el nombre) según lo que pase en el chat. Solo se avanza, nunca se regresa; si un vendedor movió la etapa a mano, respétala. Etapas en su orden actual, con su clave, su nombre y cuándo mover al cliente ahí:",
    ...lines,
  ].join("\n");
}
