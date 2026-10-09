// Escritura del Historial de etapas (contact_stage_history, 9-oct-2026). SIEMPRE con el `exec` de
// la transacción que cambia la etapa: si el cambio no se guarda, tampoco su fila. Los nombres de
// las etapas se copian como están ahora (pueden renombrarse o borrarse después). Sin
// "server-only": también lo usa el worker (Agente IA, lector, /banco).
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { contactStageHistory } from "@/lib/db/schema";
import { stageLabel, type StageChangedBy } from "./stages";

type Database = Omit<typeof db, "$client">;
export type StageHistoryExec = Pick<Database, "insert">;

export type StageChange = {
  contactId: string;
  from: string;
  to: string;
};

export async function recordStageChanges(
  exec: StageHistoryExec,
  input: {
    organizationId: string;
    stages: readonly { key: string; name: string }[];
    by: StageChangedBy;
    userId: string | null;
    changes: readonly StageChange[];
  },
): Promise<void> {
  if (input.changes.length === 0) return;
  await exec.insert(contactStageHistory).values(
    input.changes.map((c) => ({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      contactId: c.contactId,
      fromStage: c.from,
      fromName: stageLabel(input.stages, c.from),
      toStage: c.to,
      toName: stageLabel(input.stages, c.to),
      changedBy: input.by,
      userId: input.userId,
      // clock_timestamp(): varias filas de la misma transacción quedan ordenadas.
      createdAt: sql`clock_timestamp()`,
    })),
  );
}
