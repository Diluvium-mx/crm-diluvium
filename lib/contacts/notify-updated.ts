// Aviso "contacto actualizado" del tiempo real (evento `contact.updated` del SSE
// /api/inbox/stream, mismo canal `inbox_events` que la Bandeja). Es el ÚNICO
// helper: toda ruta que cambia la etapa, la temperatura, la cotización o los
// campos del Detalle de UN contacto lo llama DENTRO de la transacción de su
// escritura. NOTIFY de Postgres sale al confirmar: si la escritura se revierte, el
// aviso no sale, y nunca llega antes de que el cambio se pueda leer.
//
// Las importaciones masivas NO pasan por aquí: siguen mandando un solo
// `contacts.bulk` (trigger de la migración 0016). Borrar un contacto (ARCO) avisa con
// `notifyContactDeleted` (abajo), también dentro de su transacción.
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
      'byRole', (select m.role from member m where m.user_id = ${userId}::text and m.organization_id = c.organization_id limit 1),
      'at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text)
    from contacts c
    left join "user" u on u.id = ${userId}::text
    where c.id = ${input.contactId} and c.organization_id = ${input.organizationId}
  `);
}

/**
 * Aviso "contacto borrado" (ARCO, 7-oct-2026): la Bandeja quita sus chats y el Embudo su tarjeta
 * sin recargar (y cierran su Detalle si estaba abierto). Va DENTRO de la transacción del borrado:
 * sale al confirmar y nunca si se revierte. Sin nombre ni teléfono (el contacto ya no existe):
 * solo ids. Como la fila ya no se puede leer al confirmar, el payload va armado aquí.
 */
export async function notifyContactDeleted(
  database: NotifyExecutor,
  input: { organizationId: string; contactId: string; conversationIds: readonly string[] },
): Promise<void> {
  // NOTIFY admite hasta ~8 KB por aviso: con muchos chats (nunca pasa: uno por canal) se mandan
  // solo los primeros; la UI también quita por contacto.
  const conversationIds = input.conversationIds.slice(0, 50);
  await database.execute(sql`
    select pg_notify('inbox_events', json_build_object(
      'org', ${input.organizationId}::text,
      'type', 'contact.deleted',
      'contactId', ${input.contactId}::text,
      'conversationIds', ${JSON.stringify(conversationIds)}::json
    )::text)
  `);
}
