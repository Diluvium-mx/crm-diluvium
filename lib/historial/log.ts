// Escritura del historial de cambios (change_history; textos en ./labels.ts). SIEMPRE con
// el `exec` de la transacción del cambio: si el cambio no se guarda, tampoco su fila, y al
// revés. Sin "server-only": también lo usa el worker (pausa "un vendedor contestó").
import { sql, type SQL } from "drizzle-orm";
import type { db } from "@/lib/db";
import { changeHistory } from "@/lib/db/schema";
import type { ChangeAction, ChangeKind } from "./labels";

type Database = Omit<typeof db, "$client">;
export type HistoryExec = Pick<Database, "insert">;

type Entry<K extends ChangeKind> = {
  organizationId: string;
  userId: string | null;
  kind: K;
  action: ChangeAction[K];
  subject?: string | SQL | null;
  subjectId?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
};

export type ChangeEntry = { [K in ChangeKind]: Entry<K> }[ChangeKind];

export async function logChanges(exec: HistoryExec, entries: ChangeEntry | ChangeEntry[]): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await exec.insert(changeHistory).values(
    list.map((e) => ({
      id: crypto.randomUUID(),
      organizationId: e.organizationId,
      userId: e.userId,
      kind: e.kind,
      action: e.action,
      subject: e.subject ?? null,
      subjectId: e.subjectId ?? null,
      oldValue: e.oldValue ?? null,
      newValue: e.newValue ?? null,
      // clock_timestamp(): dos filas de la misma transacción quedan ordenadas.
      createdAt: sql`clock_timestamp()`,
    })),
  );
}

/** Nombre del contacto del chat (o su teléfono) en ese momento, dentro del mismo INSERT. */
export function chatSubject(organizationId: string, conversationId: string): SQL {
  return sql`(select coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.phone_e164, 'sin nombre')
    from conversations v join contacts c on c.id = v.contact_id and c.organization_id = v.organization_id
    where v.id = ${conversationId} and v.organization_id = ${organizationId})`;
}
