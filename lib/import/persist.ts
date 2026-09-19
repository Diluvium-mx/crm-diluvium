import { isNotNull, sql } from "drizzle-orm";
import { contacts } from "@/lib/db/schema/contacts";
import type { ParsedGhlContactsSuccess } from "./ghl-contacts-csv";

// El tipo de la BD (o una transacción) sin ejecutar el módulo @/lib/db: basta
// para inyectar la base de pruebas en los tests de integración.
type Database = typeof import("@/lib/db").db;

export interface ImportContactsFromCsvResult {
  imported: number;
  updated: number;
  invalidPhones: number;
  // Contactos que entraron SIN teléfono (celda vacía), distinto de un teléfono
  // presente pero inválido. Se reportan; no rompen la importación.
  withoutPhone: number;
  // Filas cuya etapa del CSV no coincide con ninguna del enum y cayeron a
  // "inbox". Para visibilidad; con este export siempre es 0 (todo "Inbox").
  unrecognizedStages: number;
  skipped: number;
}

// Tope duro de filas por importación: evita que un archivo enorme (el
// bodySizeLimit de 15 MB admite decenas de miles de filas cortas) monte una
// transacción interminable. Holgado sobre las ~10,900 actuales.
export const MAX_IMPORT_ROWS = 50000;

// Filas por statement en el upsert por lotes. 10,902 filas de una en una serían
// 10,902 round-trips en una sola transacción (riesgo de timeout del request y
// de mantener locks demasiado tiempo, hallazgo adversarial-review); en lotes de
// 500 son ~22 statements. 500 × ~11 columnas = 5,500 parámetros, muy por debajo
// del límite de Postgres.
const BATCH_SIZE = 500;

// Upsert atómico por (organization_id, ghl_contact_id) vía
// INSERT ... ON CONFLICT DO UPDATE sobre el índice único parcial
// contacts_org_ghl_contact_id_uidx (lib/db/schema/contacts.ts): un
// select-then-insert deja una ventana entre el SELECT y el INSERT donde dos
// importaciones simultáneas pueden ver el mismo contacto como inexistente y
// una de las dos revienta contra el índice único, tumbando toda su
// transacción (hallazgo Codex). `stage` nunca se toca en el UPDATE —
// re-sincronizar desde GHL no debe resetear el avance en el kanban de un
// contacto que el equipo ya movió de columna. Tampoco se actualiza un campo
// cuya columna no vino en el CSV: un export parcial de GHL (p. ej. solo
// Contact Id + First Name) no debe borrar teléfono/email/apellido/canal/tags
// ya cargados (segundo hallazgo Codex) — por eso `updateSet` solo incluye las
// columnas presentes en el archivo, según `columnsPresent`. En re-sync, GHL es
// la fuente: `tags` presentes se REEMPLAZAN por las del archivo (mismo criterio
// que teléfono/email); las etiquetas nacen de GHL, no se editan aún en el CRM.
export async function importParsedContacts(
  database: Database,
  organizationId: string,
  parsed: ParsedGhlContactsSuccess,
): Promise<ImportContactsFromCsvResult> {
  const { rows, skipped, columnsPresent } = parsed;

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(
      `El CSV trae ${rows.length} contactos y supera el máximo de ${MAX_IMPORT_ROWS} por importación.`,
    );
  }

  // Dedup por ghl_contact_id (gana el último): un upsert multi-fila no puede
  // tocar dos veces la misma fila destino en un mismo statement. El export real
  // no trae Contact Id duplicados; esto es defensa. Se conserva el orden de
  // primera aparición para que la importación sea determinista.
  const byId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) byId.set(row.ghlContactId, row);
  const deduped = [...byId.values()];

  // firstName es requerido por el parser (fila sin First Name se omite antes
  // de llegar aquí), así que siempre se actualiza.
  const updateSet = {
    firstName: sql`excluded.first_name`,
    source: sql`excluded.source`,
    ...(columnsPresent.lastName ? { lastName: sql`excluded.last_name` } : {}),
    // COALESCE: en un re-sync, un teléfono ausente o inválido en el CSV (ambos
    // llegan como null) NO debe borrar un número válido ya guardado (hallazgo
    // adversarial-review). Solo se sobrescribe cuando el CSV trae uno válido.
    ...(columnsPresent.phone
      ? { phoneE164: sql`coalesce(excluded.phone_e164, ${contacts.phoneE164})` }
      : {}),
    ...(columnsPresent.email ? { email: sql`excluded.email` } : {}),
    ...(columnsPresent.country ? { country: sql`excluded.country` } : {}),
    ...(columnsPresent.tags
      ? { sourceChannel: sql`excluded.source_channel`, tags: sql`excluded.tags` }
      : {}),
  };

  // ghl_contact_id → si su etapa se reconoció, para contar los fallbacks a
  // inbox solo en las filas realmente insertadas (RETURNING no garantiza orden,
  // por eso se correlaciona por id y no por posición).
  const stageRecognizedById = new Map(
    deduped.map((row) => [row.ghlContactId, row.stageRecognized]),
  );

  const valuesToInsert = deduped.map((row) => ({
    id: crypto.randomUUID(),
    organizationId,
    ghlContactId: row.ghlContactId,
    firstName: row.firstName,
    lastName: row.lastName,
    phoneE164: row.phoneE164,
    email: row.email,
    country: row.country,
    sourceChannel: row.sourceChannel,
    tags: row.tags,
    // Etapa la que venga; en re-sync no se toca (ver nota arriba).
    stage: row.stage,
    source: "ghl_import" as const,
  }));

  let imported = 0;
  let updated = 0;
  // Solo cuenta como fallback a inbox cuando la fila REALMENTE se insertó: el
  // branch ON CONFLICT nunca toca `stage`, así que un re-sync de un contacto
  // existente con etapa desconocida conserva su etapa y no degradó nada
  // (hallazgo adversarial-review).
  let unrecognizedStages = 0;

  await database.transaction(async (tx) => {
    for (let i = 0; i < valuesToInsert.length; i += BATCH_SIZE) {
      const chunk = valuesToInsert.slice(i, i + BATCH_SIZE);
      const returned = await tx
        .insert(contacts)
        .values(chunk)
        .onConflictDoUpdate({
          target: [contacts.organizationId, contacts.ghlContactId],
          targetWhere: isNotNull(contacts.ghlContactId),
          set: updateSet,
        })
        // Truco estándar de Postgres: xmax = 0 solo es cierto en la fila
        // recién insertada por este statement, nunca en la actualizada por
        // el branch ON CONFLICT.
        .returning({
          ghlContactId: contacts.ghlContactId,
          wasInsert: sql<boolean>`(xmax = 0)`,
        });

      for (const result of returned) {
        if (result.wasInsert) {
          imported += 1;
          if (result.ghlContactId && !stageRecognizedById.get(result.ghlContactId)) {
            unrecognizedStages += 1;
          }
        } else {
          updated += 1;
        }
      }
    }
  });

  return {
    imported,
    updated,
    invalidPhones: deduped.filter((row) => row.phoneInvalid).length,
    withoutPhone: deduped.filter((row) => row.phoneMissing).length,
    unrecognizedStages,
    skipped: skipped.length,
  };
}
