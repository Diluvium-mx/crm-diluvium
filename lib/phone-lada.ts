// Ubicación de un teléfono SEGÚN SU LADA: dónde se contrató la línea, no dónde
// vive el cliente (así lo quiere el dueño). PURO y seguro para el cliente.
//
// México (+52): lada de 2 dígitos para 55/56 (CDMX), 33 (Guadalajara) y 81
// (Monterrey); de 3 dígitos para el resto. El lugar sale de los datos de
// geocodificación de libphonenumber de Google (lib/phone-lada-data.ts, generado;
// fuente y versión citadas allí), por prefijo más largo, con el estado abreviado.
// Donde Google solo da el estado (667/668/669 → "Sinaloa") o nada (597), la ciudad
// sale de lib/phone-lada-cities.ts (solo si dos listas públicas coinciden) con el
// estado de Google: "Los Mochis, Sin.". Si tampoco hay ciudad ahí, queda el estado:
// no se inventan ciudades. La 664 y la 56 las fijó el dueño (LADA_LABELS). Otro
// país: su nombre en español. Sin teléfono o lada sin dato: null.
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { LADA_CITIES, LADA_LABELS } from "./phone-lada-cities";
import { LADA_PLACES } from "./phone-lada-data";

export type PhoneLocation = {
  // "Guadalajara, Jal.", "Sinaloa", "Estados Unidos".
  label: string;
  // Lada mexicana ("668", "55") o código de país ("+1") para el aviso.
  code: string;
  kind: "lada" | "pais";
};

// Abreviaturas de los estados (las de uso común en México) para los códigos que
// trae libphonenumber. CDMX no lleva estado: "Ciudad de México" ya lo dice.
const STATE_ABBR: Readonly<Record<string, string>> = {
  AGS: "Ags.",
  BCN: "B.C.",
  BCS: "B.C.S.",
  CAMP: "Camp.",
  CHIH: "Chih.",
  CHIS: "Chis.",
  COAH: "Coah.",
  COL: "Col.",
  DGO: "Dgo.",
  GRO: "Gro.",
  GTO: "Gto.",
  HGO: "Hgo.",
  JAL: "Jal.",
  MEX: "Méx.",
  MICH: "Mich.",
  MOR: "Mor.",
  NAY: "Nay.",
  NL: "N.L.",
  OAX: "Oax.",
  PUE: "Pue.",
  QRO: "Qro.",
  QROO: "Q. Roo",
  SIN: "Sin.",
  SLP: "S.L.P.",
  SON: "Son.",
  TAB: "Tab.",
  TAMPS: "Tamps.",
  TLAX: "Tlax.",
  VER: "Ver.",
  YUC: "Yuc.",
  ZAC: "Zac.",
};

// Corrección del código de estado de la fuente cuando es ambiguo: Google usa "QRO"
// tanto para Querétaro (Tequisquiapan, 414) como para Quintana Roo (Cozumel, 987).
// Solo cambia la abreviatura del estado; la ciudad sigue siendo la de la fuente.
const STATE_CODE_BY_PREFIX: Readonly<Record<string, string>> = { "52987": "QROO" };

// Los estados tal como los nombra la fuente cuando no trae ciudad ("Sinaloa",
// "Estado de México"; en los de dos estados, "México/Quintana Roo").
const STATE_CODE_BY_NAME: Readonly<Record<string, string>> = {
  Aguascalientes: "AGS",
  "Baja California": "BCN",
  "Baja California Sur": "BCS",
  Campeche: "CAMP",
  Chiapas: "CHIS",
  Chihuahua: "CHIH",
  Coahuila: "COAH",
  Colima: "COL",
  Durango: "DGO",
  "Estado de México": "MEX",
  Guanajuato: "GTO",
  Guerrero: "GRO",
  Hidalgo: "HGO",
  Jalisco: "JAL",
  México: "MEX",
  Michoacán: "MICH",
  Morelos: "MOR",
  Nayarit: "NAY",
  "Nuevo León": "NL",
  Oaxaca: "OAX",
  Puebla: "PUE",
  Querétaro: "QRO",
  "Quintana Roo": "QROO",
  "San Luis Potosí": "SLP",
  Sinaloa: "SIN",
  Sonora: "SON",
  Tabasco: "TAB",
  Tamaulipas: "TAMPS",
  Tlaxcala: "TLAX",
  Veracruz: "VER",
  Yucatán: "YUC",
  Zacatecas: "ZAC",
};

/** Solo estado(s), sin ciudad: "Sinaloa", "Nuevo León/Tamaulipas". */
function isStateOnly(place: string): boolean {
  return place.split("/").every((part) => part in STATE_CODE_BY_NAME);
}

const TWO_DIGIT_LADAS = new Set(["55", "56", "33", "81"]);
const PREFIX_LENGTHS = [...new Set(Object.keys(LADA_PLACES).map((k) => k.length))].sort((a, b) => b - a);

/** "Tlapacoyan, VER" → "Tlapacoyan, Ver."; "Ciudad de México, CDMX" → "Ciudad de México". */
export function formatLadaPlace(place: string, prefix?: string): string {
  const m = place.match(/^(.*), ([A-Z]+)$/);
  if (!m) return place;
  const code = (prefix && STATE_CODE_BY_PREFIX[prefix]) || m[2];
  if (code === "CDMX") return m[1];
  return `${m[1]}, ${STATE_ABBR[code] ?? code}`;
}

/** Lada de un número nacional mexicano de 10 dígitos. */
export function mexicanLada(national: string): string {
  return TWO_DIGIT_LADAS.has(national.slice(0, 2)) ? national.slice(0, 2) : national.slice(0, 3);
}

function googlePlace(national: string): { prefix: string; place: string } | null {
  const digits = `52${national}`;
  for (const len of PREFIX_LENGTHS) {
    const prefix = digits.slice(0, len);
    const place = LADA_PLACES[prefix];
    if (place) return { prefix, place };
  }
  return null;
}

function mexicoLocation(national: string): PhoneLocation | null {
  const code = mexicanLada(national);
  const fixed = LADA_LABELS[code];
  if (fixed) return { label: fixed, code, kind: "lada" };
  const found = googlePlace(national);
  const city = LADA_CITIES[code];
  // La ciudad de las listas solo llena huecos: si Google ya trae ciudad, manda Google.
  if (city && (!found || isStateOnly(found.place))) {
    const state = found ? STATE_CODE_BY_NAME[found.place] : undefined;
    return { label: state ? `${city}, ${STATE_ABBR[state]}` : city, code, kind: "lada" };
  }
  return found ? { label: formatLadaPlace(found.place, found.prefix), code, kind: "lada" } : null;
}

let countryNames: Intl.DisplayNames | null | undefined;
function countryName(iso: string): string | null {
  if (countryNames === undefined) {
    try {
      countryNames = new Intl.DisplayNames(["es"], { type: "region" });
    } catch {
      countryNames = null;
    }
  }
  const name = countryNames?.of(iso);
  return name && name !== iso ? name : null;
}

export function phoneLocation(e164: string | null | undefined): PhoneLocation | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  // +52 + 10 dígitos (y el +521 heredado de WhatsApp, que el CRM ya no guarda).
  const mx = digits.match(/^52(?:1(?=\d{10}$))?(\d{10})$/);
  if (mx) return mexicoLocation(mx[1]);
  const parsed = parsePhoneNumberFromString(e164.startsWith("+") ? e164 : `+${digits}`);
  if (!parsed?.country || parsed.country === "MX") return null;
  const name = countryName(parsed.country);
  return name ? { label: name, code: `+${parsed.countryCallingCode}`, kind: "pais" } : null;
}

/** Aviso al pasar el cursor: "Según la lada 668 (dónde se contrató la línea)". */
export function phoneLocationHint(loc: PhoneLocation): string {
  return loc.kind === "lada"
    ? `Según la lada ${loc.code} (dónde se contrató la línea)`
    : `Según el código de país ${loc.code} (dónde se contrató la línea)`;
}
