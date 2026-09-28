import type { InferSelectModel } from "drizzle-orm";
import { contacts } from "@/lib/db/schema/contacts";

// Columnas que el Embudo necesita de cada contacto: la tarjeta, el buscador (nombre y
// teléfono), el orden de las columnas y la cabecera del pop-up. Lo demás (calificación,
// entradas, comentarios, campos personalizados) lo carga el pop-up al abrirse
// (getContactDetails). Con ~11k contactos, traer la fila completa movía ~8 MB en cada
// apertura del Embudo (revisión completa, B14, 28-sep-2026).
export const boardContactColumns = {
  id: contacts.id,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  phoneE164: contacts.phoneE164,
  stage: contacts.stage,
  temperature: contacts.temperature,
  esPrueba: contacts.esPrueba,
  sourceChannel: contacts.sourceChannel,
  createdAt: contacts.createdAt,
  stageChangedAt: contacts.stageChangedAt,
  stageChangedBy: contacts.stageChangedBy,
};

/** Un contacto como lo recibe el Embudo: las llaves salen de boardContactColumns. */
export type BoardContact = Pick<InferSelectModel<typeof contacts>, keyof typeof boardContactColumns>;
