// Normalización E.164 obligatoria antes de guardar un teléfono (CLAUDE.md §5).
// Función única, reusada en formularios, importación CSV y el webhook de WhatsApp.
//
// Validación y partes por país con libphonenumber-js (port de Google
// libphonenumber, metadata "max" = todos los países y tipos de número):
// https://gitlab.com/catamphetamine/libphonenumber-js · metadata de
// https://github.com/google/libphonenumber/tree/master/resources
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

// México: desde 2019-2020 los celulares se marcan sin el "1" tras el +52, y el
// ÚNICO formato del CRM es +52 + 10 dígitos. WhatsApp todavía identifica
// muchos números como 521XXXXXXXXXX (wa_id heredado; visto en prod): el "1" se
// quita en la ENTRADA y nunca se guarda ni se muestra +521.
const MX_WITH_ONE = /^\+521(\d{10})$/;
const MX_CANONICAL = /^\+52(\d{10})$/;

export function canonicalPhone(e164: string): string {
  const legacy = e164.match(MX_WITH_ONE);
  return legacy ? `+52${legacy[1]}` : e164;
}

/**
 * Teléfono crudo → E.164 canónico. Lanza si no tiene forma E.164 (con código
 * de país). Si libphonenumber lo da por válido se usa su forma canónica; si no
 * lo reconoce (p. ej. un celular viejo de Brasil sin el 9) se conserva tal cual:
 * rechazarlo perdería el contacto, y la fusión/limpieza es un paso aparte.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const withPlus = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  const candidate = withPlus.replace(/[\s()\-.]/g, "");

  if (!E164_PATTERN.test(candidate)) {
    throw new Error(
      `Teléfono inválido: "${raw}". Usa formato E.164 con código de país, ej. +525512345678.`,
    );
  }

  const canonical = canonicalPhone(candidate);
  const parsed = parsePhoneNumberFromString(canonical);
  return parsed?.isValid() ? parsed.number : canonical;
}

/** Formas con las que un teléfono pudo quedar guardado (contactos previos al backfill traían +521). */
export function phoneLookupVariants(e164: string): string[] {
  const canonical = canonicalPhone(e164);
  const mx = canonical.match(MX_CANONICAL);
  return mx ? [canonical, `+521${mx[1]}`] : [canonical];
}

export type PhoneParts = {
  phoneCountryCode: string | null; // "52"
  phoneNational: string | null; // "6682426364"
  phoneCountryIso: string | null; // "MX"
};

/** Prefijo de país, número nacional y país ISO de un E.164 ya normalizado. */
export function phoneParts(e164: string | null | undefined): PhoneParts {
  const parsed = e164 ? parsePhoneNumberFromString(canonicalPhone(e164)) : undefined;
  if (!parsed) return { phoneCountryCode: null, phoneNational: null, phoneCountryIso: null };
  return {
    phoneCountryCode: parsed.countryCallingCode,
    phoneNational: parsed.nationalNumber,
    phoneCountryIso: parsed.country ?? null,
  };
}

/** Columnas de teléfono de `contacts` listas para insertar/actualizar. */
export function phoneColumns(e164: string | null): PhoneParts & { phoneE164: string | null } {
  return { phoneE164: e164, ...phoneParts(e164) };
}

/**
 * Prefijos de `phone_national` que puede estar buscando alguien que teclea
 * dígitos: los 10 dígitos solos, con 52 / +52 delante, o el 521 heredado.
 * Se usan con LIKE 'x%' sobre el índice (org, phone_national).
 */
export function nationalSearchPrefixes(term: string): string[] {
  const digits = term.replace(/\D/g, "");
  if (digits.length < 3) return [];
  const prefixes = new Set([digits]);
  const legacy = digits.match(/^521(\d{10})$/);
  if (legacy) prefixes.add(legacy[1]);
  const parsed = parsePhoneNumberFromString(`+${legacy ? `52${legacy[1]}` : digits}`);
  if (parsed?.isPossible()) prefixes.add(parsed.nationalNumber);
  return [...prefixes];
}

// El país de `contacts.country` viene de GHL como nombre en inglés ("Mexico").
// Al deducirlo del teléfono se usa el mismo estilo para no mezclar formatos.
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** Nombre del país (inglés, estilo GHL) deducido del teléfono, o null. */
export function countryFromPhone(e164: string | null | undefined): string | null {
  const iso = phoneParts(e164).phoneCountryIso;
  return iso ? (regionNames.of(iso) ?? null) : null;
}
