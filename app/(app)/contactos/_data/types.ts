import type { InferSelectModel } from "drizzle-orm";
import type { contacts, contactStageEnum, contactTemperatureEnum } from "@/lib/db/schema/contacts";

// `import type` se borra por completo al compilar (isolatedModules): el
// board (Client Component) puede importar este archivo sin arrastrar
// drizzle-orm ni el schema de servidor a su bundle.
export type Contact = InferSelectModel<typeof contacts>;
export type Stage = (typeof contactStageEnum.enumValues)[number];

// Record<Stage, string> obliga a listar las 5 etapas exactas del enum de
// Postgres (lib/db/schema/contacts.ts): si el enum cambia, esto deja de
// compilar hasta que se actualice aquí también.
export const STAGE_LABELS: Record<Stage, string> = {
  inbox: "Inbox",
  prospecto: "Prospecto",
  interesado: "Interesado",
  cerca_compra: "Cerca de compra",
  compra: "Compra",
};

export const STAGES = Object.keys(STAGE_LABELS) as Stage[];

export type Temperature = (typeof contactTemperatureEnum.enumValues)[number];

// Emoji que se muestra en la tarjeta (la referencia visual de Leadsales usa
// íconos de temperatura). Record<Temperature, ...> obliga a cubrir los 4
// valores exactos del enum: si el enum cambia, deja de compilar.
export const TEMPERATURE_EMOJI: Record<Temperature, string> = {
  caliente: "🔥",
  frio: "🧊",
  en_espera: "⏳",
  destacado: "⭐",
};

// Etiqueta accesible (title/aria-label): un emoji suelto no es legible por
// lector de pantalla.
export const TEMPERATURE_LABELS: Record<Temperature, string> = {
  caliente: "Caliente",
  frio: "Frío",
  en_espera: "En espera",
  destacado: "Destacado",
};

export const TEMPERATURES = Object.keys(TEMPERATURE_LABELS) as Temperature[];

export function getContactFullName(contact: Pick<Contact, "firstName" | "lastName">): string {
  return contact.lastName ? `${contact.firstName} ${contact.lastName}` : contact.firstName;
}
