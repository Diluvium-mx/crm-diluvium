// Zona horaria del cliente SEGÚN SU LADA, para mandar el seguimiento a la hora del caso en
// SU hora (docs/seguimientos.md §9). PURO. Desde 2022 México no cambia de horario, salvo la
// frontera norte (Baja California, Ciudad Juárez, Ojinaga y la frontera de Coahuila, Nuevo León y
// Tamaulipas, como Estados Unidos): por eso se usan las zonas IANA y no un desfase fijo.
//   Baja California → Tijuana · Sonora → Hermosillo · Sinaloa, B.C.S. y Nayarit → Mazatlán
//   (la lada 329, Bahía de Banderas, va con el centro) · Chihuahua → Chihuahua (656, Ciudad
//   Juárez → Ciudad_Juarez; 626, Ojinaga → Ojinaga) · Quintana Roo → Cancún · ladas de la frontera
//   noreste (Nuevo Laredo, Reynosa, Matamoros, Valle Hermoso, Miguel Alemán, Piedras Negras, Acuña)
//   → Matamoros: hora del centro con horario de verano (10-oct-2026: antes iban con el centro y de
//   marzo a noviembre su «21:00» les llegaba a las 22:00) · el resto → Ciudad de México.
// Número de México sin estado en la fuente: centro. Número de otro país o sin teléfono:
// Mazatlán (la hora del CRM).
import { mexicanLadaStates } from "@/lib/phone-lada";

export const DEFAULT_CLIENT_ZONE = "America/Mazatlan";
const CENTER = "America/Mexico_City";

const ZONE_BY_STATE: Readonly<Record<string, string>> = {
  BCN: "America/Tijuana",
  SON: "America/Hermosillo",
  SIN: "America/Mazatlan",
  BCS: "America/Mazatlan",
  NAY: "America/Mazatlan",
  CHIH: "America/Chihuahua",
  QROO: "America/Cancun",
};

const BORDER_NORTHEAST = "America/Matamoros";

const ZONE_BY_LADA: Readonly<Record<string, string>> = {
  "329": CENTER,
  "656": "America/Ciudad_Juarez",
  "626": "America/Ojinaga",
  "867": BORDER_NORTHEAST, // Nuevo Laredo
  "868": BORDER_NORTHEAST, // Matamoros
  "894": BORDER_NORTHEAST, // Valle Hermoso
  "897": BORDER_NORTHEAST, // Miguel Alemán, Mier, Camargo
  "899": BORDER_NORTHEAST, // Reynosa, Río Bravo
  "877": BORDER_NORTHEAST, // Ciudad Acuña
  "878": BORDER_NORTHEAST, // Piedras Negras
};

export function zoneForPhone(e164: string | null | undefined): string {
  const found = mexicanLadaStates(e164);
  if (!found) return DEFAULT_CLIENT_ZONE;
  const byLada = ZONE_BY_LADA[found.lada];
  if (byLada) return byLada;
  const zones = new Set(found.states.map((s) => ZONE_BY_STATE[s] ?? CENTER));
  // Lada que cruza estados con distinta hora: el centro.
  return zones.size === 1 ? [...zones][0] : CENTER;
}
