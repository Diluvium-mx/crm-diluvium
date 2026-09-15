import type { InferSelectModel } from "drizzle-orm";
import type { contacts, contactStageEnum } from "@/lib/db/schema/contacts";

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
