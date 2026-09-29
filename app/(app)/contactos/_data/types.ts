import type { InferSelectModel } from "drizzle-orm";
import type { contacts, contactTemperatureEnum } from "@/lib/db/schema/contacts";

// `import type` se borra por completo al compilar (isolatedModules): el
// board (Client Component) puede importar este archivo sin arrastrar
// drizzle-orm ni el schema de servidor a su bundle.
export type Contact = InferSelectModel<typeof contacts>;

// Lo que el Embudo recibe de cada contacto (solo tipo: no arrastra drizzle al bundle).
// El pop-up carga el resto al abrirse.
export type { BoardContact } from "@/lib/contacts/board-contact";

// Clave de una etapa del Embudo (funnel_stages.key). Desde "Columnas del Embudo"
// (26-sep-2026) las etapas son editables por organización: nombre, orden y color
// salen de `useFunnelStages()` (app/(app)/_components/funnel-stages-provider.tsx) en la
// UI y de `listFunnelStages()` en el servidor; ya no hay lista fija aquí.
export type Stage = string;

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

// Las que se pueden ASIGNAR (menús de la Bandeja y del Embudo). ⭐ ya no es temperatura
// desde la 0048 (29-sep-2026): Destacado es la marca aparte `contacts.destacado`. El emoji
// y la etiqueta de 'destacado' siguen arriba solo para que el tipo cubra todo el enum.
export const TEMPERATURES: Temperature[] = ["caliente", "frio", "en_espera"];

// Destacado (marca del contacto, combinable con la temperatura).
export const DESTACADO_EMOJI = "⭐";

export function getContactFullName(contact: Pick<Contact, "firstName" | "lastName">): string {
  return contact.lastName ? `${contact.firstName} ${contact.lastName}` : contact.firstName;
}
