import Papa from "papaparse";
import { normalizePhone } from "@/lib/phone";
import { contactStageEnum } from "@/lib/db/schema/contacts";
import { STAGE_LABELS } from "@/app/(app)/contactos/_data/types";

export type SourceChannel = "whatsapp" | "fb" | "instagram";
export type ContactStage = (typeof contactStageEnum.enumValues)[number];

export interface ParsedGhlContactRow {
  ghlContactId: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string | null;
  phoneInvalid: boolean;
  // true solo cuando NO vino teléfono (celda vacía). Distinto de phoneInvalid,
  // que marca un teléfono presente pero mal formado.
  phoneMissing: boolean;
  email: string | null;
  // País (columna Country de GHL); null si no vino.
  country: string | null;
  // Canal derivado de los tags de anuncio; para este export (leads de
  // WhatsApp) nunca es null: sin tag de anuncio el canal es "whatsapp".
  sourceChannel: SourceChannel;
  // Etiquetas de negocio conservadas tal cual (sin las de sistema).
  tags: string[];
  // Celda cruda de Opportunities para reporte/auditoría; null si vino vacía.
  pipelineStage: string | null;
  // Etapa mapeada al enum de la BD. Sin forzar: la que venga (la MÁS AVANZADA
  // si hay varias oportunidades). Vacía → "inbox" (default). Con valor pero
  // sin etapa reconocible → "inbox" y stageRecognized=false (para reportarla).
  stage: ContactStage;
  stageRecognized: boolean;
}

export interface SkippedGhlContactRow {
  rowNumber: number; // 1-based; cuenta solo filas de datos.
  reason: string;
}

// true si el header (case-insensitive, trim) estaba presente en el CSV.
export interface GhlCsvColumnsPresent {
  lastName: boolean;
  phone: boolean;
  email: boolean;
  tags: boolean; // sourceChannel y tags se derivan de esta columna
  country: boolean;
  opportunities: boolean; // la etapa se deriva de esta columna
}

export interface CsvStructuralError {
  rowNumber: number; // error.row + 1; usa 0 si Papa.parse no da row.
  code: string;
  message: string;
}

export type ParseGhlContactsCsvResult =
  | {
      ok: true;
      rows: ParsedGhlContactRow[];
      skipped: SkippedGhlContactRow[];
      totalRows: number;
      columnsPresent: GhlCsvColumnsPresent;
    }
  | {
      ok: false;
      errors: CsvStructuralError[];
    };

export type ParsedGhlContactsSuccess = Extract<
  ParseGhlContactsCsvResult,
  { ok: true }
>;

// GHL exporta las tags dentro de UNA celda separadas por ";" (a veces ","),
// p. ej. "inbound whatsapp; fb-ad-lead-whatsapp; wa: 5216682419579". Se
// aceptan ambos separadores por robustez.
function splitTags(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

// Tags de anuncio que YA se convirtieron en source_channel. Única fuente de
// verdad: de aquí salen tanto el canal como el filtrado (se descartan como tag
// de negocio precisamente porque son las que se volvieron canal). Un tag de
// anuncio de otra red que aún no soportamos (p. ej. tiktok-ad-lead-whatsapp)
// NO se descarta: se conserva como etiqueta para no perder el origen.
const AD_LEAD_TAGS = {
  "instagram-ad-lead-whatsapp": "instagram",
  "fb-ad-lead-whatsapp": "fb",
} as const satisfies Record<string, SourceChannel>;

// wa:<numero> exacto (con o sin espacio): "wa: 5216682419579" / "wa:5216…".
// Ajustado a dígitos para no descartar una etiqueta de negocio como
// "wa: pendiente".
const WA_NUMBER_TAG = /^wa:\s*\d+$/;

// Tags de SISTEMA que no aportan como etiqueta de negocio y se descartan:
//  - wa:<numero>
//  - inbound whatsapp
//  - another-device-replied-whatsapp
//  - los tags de anuncio ya convertidos en canal (AD_LEAD_TAGS)
function isSystemTag(tag: string): boolean {
  const t = tag.trim().toLowerCase();
  if (!t) return true;
  if (WA_NUMBER_TAG.test(t)) return true;
  if (t === "inbound whatsapp") return true;
  if (t === "another-device-replied-whatsapp") return true;
  if (t in AD_LEAD_TAGS) return true;
  return false;
}

// Canal SOLO desde los tags de anuncio. instagram-ad-lead-whatsapp →
// Instagram; fb-ad-lead-whatsapp → Facebook; cualquier otra cosa → whatsapp
// (todos estos contactos son leads de WhatsApp). Instagram tiene prioridad si
// por error viniera con ambos tags (no debería ocurrir).
function sourceChannelFromTags(rawTags: string[]): SourceChannel {
  const lower = new Set(rawTags.map((tag) => tag.toLowerCase()));
  if (lower.has("instagram-ad-lead-whatsapp")) return "instagram";
  if (lower.has("fb-ad-lead-whatsapp")) return "fb";
  return "whatsapp";
}

// Conserva el orden y el texto original (mayúsculas/acentos), quitando
// duplicados exactos sin distinguir mayúsculas.
function dedupePreservingOrder(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

// La columna Opportunities de GHL trae, por oportunidad, "<status> <pipeline>
// <Etapa>" (sin dos puntos ni guion), p. ej. "open Embudo de ventas Diluvium
// Cerca de compra". En este CRM el pipeline es SIEMPRE "Embudo de ventas
// Diluvium" (verificado sobre el export real de 10,902 filas). El patrón está
// ANCLADO: un status (una palabra) + el nombre EXACTO del pipeline + la etapa.
// Así una oportunidad de otro pipeline —aunque su nombre termine igual, p. ej.
// "Otro Embudo de ventas Diluvium"— NO se cuela: queda sin reconocer y se
// reporta, en vez de clasificarse mal. Si algún día hay más de un pipeline,
// esto deja de reconocer los ajenos a propósito (revisar entonces).
const GHL_PIPELINE = "Embudo de ventas Diluvium";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ^(status conocido)? <pipeline exacto> <etiqueta>$  (case-insensitive). El
// status es opcional pero SOLO uno de los de GHL: si fuera "\S+" (cualquier
// palabra), un pipeline ajeno como "Otro Embudo de ventas Diluvium" colaría
// "Otro" como status y se clasificaría mal (hallazgo adversarial-review). La
// etiqueta se mapea EXACTA contra STAGE_LABELS después.
const GHL_OPPORTUNITY_STATUSES = ["open", "won", "lost", "abandoned"];
const OPPORTUNITY_PATTERN = new RegExp(
  `^(?:(?:${GHL_OPPORTUNITY_STATUSES.join("|")})\\s+)?` +
    `${escapeRegExp(GHL_PIPELINE.toLowerCase())}\\s+(.+)$`,
);

// Etiqueta humana (STAGE_LABELS, única fuente de verdad; si el enum cambia,
// Record<Stage,...> allá deja de compilar) → enum. Coincidencia EXACTA, así no
// hay que ordenar por longitud: "cerca de compra" no colisiona con "compra".
const STAGE_BY_LABEL = new Map<string, ContactStage>(
  contactStageEnum.enumValues.map((value) => [STAGE_LABELS[value].toLowerCase(), value]),
);

// Rango en el embudo = orden de declaración del enum (inbox < prospecto <
// interesado < cerca_compra < compra). Sirve para elegir la etapa MÁS AVANZADA
// cuando un contacto trae varias oportunidades.
const STAGE_RANK = new Map<ContactStage, number>(
  contactStageEnum.enumValues.map((value, index) => [value, index]),
);

function stageFromOpportunitySegment(segment: string): ContactStage | null {
  const match = OPPORTUNITY_PATTERN.exec(segment.trim().toLowerCase());
  if (!match) return null;
  return STAGE_BY_LABEL.get(match[1].trim()) ?? null;
}

// Resuelve la etapa desde la celda Opportunities. Varias oportunidades van
// separadas por coma → se toma la MÁS AVANZADA. Vacía → inbox (default), no se
// reporta. Con valor pero sin ninguna etapa reconocible → inbox y
// recognized=false (para reportarla). hadValue distingue "vino vacía" de
// "vino con algo".
function contactStageFromOpportunities(raw: string): {
  stage: ContactStage;
  recognized: boolean;
  hadValue: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { stage: "inbox", recognized: true, hadValue: false };

  let best: ContactStage | null = null;
  for (const segment of trimmed.split(",")) {
    const stage = stageFromOpportunitySegment(segment);
    if (stage === null) continue;
    if (best === null || STAGE_RANK.get(stage)! > STAGE_RANK.get(best)!) {
      best = stage;
    }
  }

  if (best === null) return { stage: "inbox", recognized: false, hadValue: true };
  return { stage: best, recognized: true, hadValue: true };
}

export function parseGhlContactsCsv(csvText: string): ParseGhlContactsCsvResult {
  const { data, errors, meta } = Papa.parse<Record<string, string | undefined>>(csvText, {
    // Evita errores de autodetección en archivos vacíos o de una sola columna.
    delimiter: ",",
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  if (errors.length > 0) {
    return {
      ok: false,
      errors: errors.map((error) => ({
        rowNumber: error.row === undefined ? 0 : error.row + 1,
        code: error.code,
        message: error.message,
      })),
    };
  }

  const fields = new Set(meta.fields ?? []);
  const columnsPresent: GhlCsvColumnsPresent = {
    lastName: fields.has("last name"),
    phone: fields.has("phone"),
    email: fields.has("email"),
    tags: fields.has("tags"),
    country: fields.has("country"),
    opportunities: fields.has("opportunities"),
  };
  const rows: ParsedGhlContactRow[] = [];
  const skipped: SkippedGhlContactRow[] = [];

  data.forEach((row, index) => {
    const ghlContactId = row["contact id"]?.trim() ?? "";
    const firstName = row["first name"]?.trim() ?? "";
    if (!ghlContactId || !firstName) {
      skipped.push({
        rowNumber: index + 1,
        reason: !ghlContactId ? "Falta Contact Id" : "Falta First Name",
      });
      return;
    }

    const phone = row.phone?.trim() ?? "";
    let phoneE164: string | null = null;
    let phoneInvalid = false;
    if (phone) {
      try {
        phoneE164 = normalizePhone(phone);
      } catch {
        phoneInvalid = true;
      }
    }

    const rawTags = splitTags(row.tags ?? "");
    const opportunitiesRaw = row.opportunities?.trim() ?? "";
    const { stage, recognized } = contactStageFromOpportunities(opportunitiesRaw);

    rows.push({
      ghlContactId,
      // firstName/lastName se conservan tal cual (emoji, minúsculas, acentos).
      firstName,
      lastName: row["last name"]?.trim() || null,
      phoneE164,
      phoneInvalid,
      phoneMissing: phone === "",
      email: row.email?.trim() || null,
      country: row.country?.trim() || null,
      sourceChannel: sourceChannelFromTags(rawTags),
      tags: dedupePreservingOrder(rawTags.filter((tag) => !isSystemTag(tag))),
      pipelineStage: opportunitiesRaw || null,
      stage,
      stageRecognized: recognized,
    });
  });

  return { ok: true, rows, skipped, totalRows: data.length, columnsPresent };
}
