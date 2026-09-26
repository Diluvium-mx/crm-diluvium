// Aviso "contacto actualizado" del tiempo real (evento `contact.updated` del SSE
// /api/inbox/stream, mismo canal `inbox_events` que la Bandeja). Es el ÚNICO
// helper: toda ruta que cambia la etapa, la temperatura, la cotización o los
// campos del Detalle de UN contacto lo llama DENTRO de la transacción de su
// escritura. NOTIFY de Postgres sale al confirmar: si la escritura se revierte, el
// aviso no sale, y nunca llega antes de que el cambio se pueda leer.
//
// Las importaciones masivas NO pasan por aquí: siguen mandando un solo
// `contacts.bulk` (trigger de la migración 0016).
//
// El payload lo arma Postgres con el contacto de ESA organización (sin él, no hay
// aviso) y lleva `org`: el hub del SSE solo lo entrega a esa organización.
import { sql } from "drizzle-orm";
import type { ContactChange } from "@/lib/inbox/types";

export type { ContactChange } from "@/lib/inbox/types";

type Database = Omit<typeof import("@/lib/db").db, "$client">;
/** La conexión principal o una transacción (lo normal: la de la escritura). */
export type NotifyExecutor = Pick<Database, "execute">;

/**
 * Quién hizo el cambio. Automatización con `userId` = el vendedor que la disparó
 * con un comando (/banco): a él no le sale el aviso emergente.
 */
export type ContactActor =
  | { kind: "vendedor"; userId: string }
  | { kind: "agente" }
  | { kind: "automatizacion"; userId?: string | null };

export type NotifyContactUpdatedInput = {
  organizationId: string;
  contactId: string;
  changes: readonly ContactChange[];
  /** Solo si cambió la etapa. */
  stage?: { from: string; to: string };
  by: ContactActor;
};

export async function notifyContactUpdated(database: NotifyExecutor, input: NotifyContactUpdatedInput): Promise<void> {
  const changes = [...new Set(input.changes)];
  if (changes.length === 0) return;
  const userId = input.by.kind === "agente" ? null : (input.by.userId ?? null);
  await database.execute(sql`
    select pg_notify('inbox_events', json_build_object(
      'org', c.organization_id,
      'type', 'contact.updated',
      'contactId', c.id,
      'contactName', left(concat_ws(' ', c.first_name, nullif(c.last_name, '')), 120),
      'changes', ${JSON.stringify(changes)}::json,
      'stageFrom', ${input.stage?.from ?? null}::text,
      'stageTo', ${input.stage?.to ?? null}::text,
      'by', ${input.by.kind}::text,
      'byUserId', ${userId}::text,
      'byName', left(u.name, 80),
      'at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text)
    from contacts c
    left join "user" u on u.id = ${userId}::text
    where c.id = ${input.contactId} and c.organization_id = ${input.organizationId}
  `);
}
