"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gt, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { contacts, contactTemperatureEnum } from "@/lib/db/schema/contacts";
import { conversations } from "@/lib/db/schema/messaging";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { boardContactColumns, type BoardContact } from "@/lib/contacts/board-contact";
import { isStageKey, roleKey } from "@/lib/contacts/stages";
import { countryFromPhone, normalizePhone, phoneColumns } from "@/lib/phone";
import { parseGhlContactsCsv } from "@/lib/import/ghl-contacts-csv";
import { onContactStageEntered } from "@/lib/workflows/triggers";
import { notifyContactUpdated } from "@/lib/contacts/notify-updated";
import {
  funnelSignalsForOrg,
  lastInboundFromWindow,
  MAX_SIGNAL_CONVERSATIONS,
  type FunnelSignal,
} from "@/lib/contacts/funnel-signals";
import {
  importParsedContacts,
  type ImportContactsFromCsvResult,
} from "@/lib/import/persist";

export type { ImportContactsFromCsvResult } from "@/lib/import/persist";

async function requireActiveOrganizationId(): Promise<string> {
  return (await requireActiveMembership()).organizationId;
}

/**
 * Contactos del Embudo con la hora del último mensaje del cliente (ordena la columna
 * junto con stageChangedAt): max(window_expires_at) de sus chats en un solo agrupado
 * de `conversations` (hash join, sin subconsulta por contacto; ver
 * lastInboundFromWindow). `where` acota los contactos, siempre dentro de la organización.
 */
async function selectBoardContacts(
  organizationId: string,
  where: SQL | undefined,
  limit?: number,
): Promise<BoardContact[]> {
  const lastWindow = db
    .select({
      contactId: conversations.contactId,
      windowMs: sql<number | string | null>`(extract(epoch from max(${conversations.windowExpiresAt})) * 1000)::float8`.as("window_ms"),
    })
    .from(conversations)
    .where(eq(conversations.organizationId, organizationId))
    .groupBy(conversations.contactId)
    .as("last_window");
  const query = db
    .select({ ...boardContactColumns, windowMs: lastWindow.windowMs })
    .from(contacts)
    .leftJoin(lastWindow, eq(lastWindow.contactId, contacts.id))
    .where(and(eq(contacts.organizationId, organizationId), where))
    .orderBy(desc(contacts.stageChangedAt), desc(contacts.createdAt));
  const rows = limit === undefined ? await query : await query.limit(limit);
  return rows.map(({ windowMs, ...contact }) => ({ ...contact, lastInboundAt: lastInboundFromWindow(windowMs) }));
}

// Todos los agentes ven todos los contactos de su organización (CLAUDE.md §5):
// sin filtro por dueño/asignado.
export async function listContacts(): Promise<BoardContact[]> {
  const organizationId = await requireActiveOrganizationId();
  return selectBoardContacts(organizationId, undefined);
}

/**
 * Contactos por id (tiempo real del kanban: `contact.created` del SSE). Máximo
 * 200 por llamada; siempre acotado a la organización activa.
 */
export async function getContactsByIds(ids: string[]): Promise<BoardContact[]> {
  const organizationId = await requireActiveOrganizationId();
  const wanted = z.array(z.string().min(1)).max(200).parse(ids);
  if (wanted.length === 0) return [];
  return selectBoardContacts(organizationId, inArray(contacts.id, wanted));
}

// Margen para relojes y para escrituras que confirmaron justo en el corte.
const CHANGED_SINCE_MARGIN_MS = 5_000;
const MAX_CHANGED_SINCE = 200;

/**
 * Lo que el Embudo pudo perderse entre que cargó la página y que empezó a escuchar
 * el SSE, o mientras la conexión estuvo caída: los contactos que cambiaron de
 * etapa desde `since` (ISO, con 5 s de margen) y la temperatura de TODOS los que
 * tienen una (la temperatura no lleva hora: se compara completa, en pares
 * compactos id → temperatura; sin par = sin temperatura). `now` es el `since` de la
 * siguiente vuelta (se toma ANTES de leer: nada se escapa entre dos lecturas). Con
 * más de 200 cambios de etapa, `tooMany` (el tablero se recarga completo).
 * Acotado a la organización activa.
 */
export async function getContactsChangedSince(since: string) {
  const organizationId = await requireActiveOrganizationId();
  const from = new Date(new Date(z.iso.datetime().parse(since)).getTime() - CHANGED_SINCE_MARGIN_MS);
  const now = new Date().toISOString();
  const [rows, withTemperature] = await Promise.all([
    selectBoardContacts(organizationId, gt(contacts.stageChangedAt, from), MAX_CHANGED_SINCE + 1),
    db
      .select({ id: contacts.id, temperature: contacts.temperature })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), isNotNull(contacts.temperature))),
  ]);
  const tooMany = rows.length > MAX_CHANGED_SINCE;
  const temperatures = withTemperature.flatMap((row) => (row.temperature ? [[row.id, row.temperature] as const] : []));
  return { contacts: tooMany ? [] : rows, temperatures, now, tooMany };
}

/**
 * Señales de las tarjetas del Embudo (no vistos, por contestar, urgente). Sin ids:
 * toda la organización (carga y `reload` del SSE). Con ids (máximo 200): los
 * contactos de esas conversaciones, para el tiempo real. Ver lib/contacts/funnel-signals.ts.
 */
export async function getFunnelSignals(conversationIds?: string[]): Promise<Record<string, FunnelSignal>> {
  const organizationId = await requireActiveOrganizationId();
  const ids =
    conversationIds === undefined
      ? undefined
      : z.array(z.string().min(1).max(128)).max(MAX_SIGNAL_CONVERSATIONS).parse(conversationIds);
  return funnelSignalsForOrg(organizationId, ids);
}

const createContactSchema = z.object({
  firstName: z.string().trim().min(1, "El nombre es obligatorio."),
  lastName: z.string().trim().optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.email("Email inválido.").optional().or(z.literal("")),
  // Clave de una etapa vigente de la organización (se valida contra funnel_stages).
  stage: z.string().trim().min(1).max(40).optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export async function createContact(input: CreateContactInput) {
  const organizationId = await requireActiveOrganizationId();
  const parsed = createContactSchema.parse(input);
  const phoneE164 = parsed.phone ? normalizePhone(parsed.phone) : null;
  const stages = await listFunnelStages(organizationId);
  if (parsed.stage !== undefined && !isStageKey(stages, parsed.stage)) throw new Error("Esa etapa ya no existe en el Embudo.");
  const entry = roleKey(stages, "entrada");
  if (!entry) throw new Error("El Embudo no tiene etapa de entrada; revísalo en Agente IA → Etapas del embudo.");

  const [created] = await db
    .insert(contacts)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      firstName: parsed.firstName,
      lastName: parsed.lastName || null,
      ...phoneColumns(phoneE164),
      country: countryFromPhone(phoneE164),
      email: parsed.email || null,
      stage: parsed.stage ?? entry,
    })
    .returning();

  revalidatePath("/embudo");

  return created;
}

const updateContactStageSchema = z.object({
  contactId: z.string().trim().min(1, "contactId es obligatorio."),
  // Clave de una etapa vigente (se valida contra funnel_stages de la organización).
  stage: z.string().trim().min(1).max(40),
});

export type UpdateContactStageInput = z.infer<typeof updateContactStageSchema>;

export async function updateContactStage(input: UpdateContactStageInput) {
  const { organizationId, userId } = await requireActiveMembership();
  const parsed = updateContactStageSchema.parse(input);
  if (!isStageKey(await listFunnelStages(organizationId), parsed.stage)) {
    throw new Error("Esa etapa ya no existe en el Embudo; recarga la página.");
  }

  // Solo cambia (y dispara) si la etapa es distinta: soltar la tarjeta en su
  // misma columna no es "entrar" a la etapa. El aviso en vivo (contact.updated,
  // con la etapa de → a) sale en la MISMA transacción: llega al confirmar.
  const updated = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ stage: contacts.stage })
      .from(contacts)
      .where(and(eq(contacts.id, parsed.contactId), eq(contacts.organizationId, organizationId)))
      .limit(1)
      .for("update");
    if (!before || before.stage === parsed.stage) return undefined;
    const [row] = await tx
      .update(contacts)
      .set({ stage: parsed.stage, stageChangedAt: new Date(), stageChangedBy: "vendedor" })
      .where(
        and(
          eq(contacts.id, parsed.contactId),
          eq(contacts.organizationId, organizationId),
          ne(contacts.stage, parsed.stage),
        ),
      )
      .returning();
    if (row) {
      await notifyContactUpdated(tx, {
        organizationId,
        contactId: row.id,
        changes: ["etapa"],
        stage: { from: before.stage, to: row.stage },
        by: { kind: "vendedor", userId },
      });
    }
    return row;
  });

  if (!updated) {
    const [same] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, parsed.contactId), eq(contacts.organizationId, organizationId)))
      .limit(1);
    if (!same) throw new Error("Contacto no encontrado en esta organización.");
    return same;
  }

  // Fase D: workflows con "al entrar a esta etapa". Aislado: nunca rompe el cambio.
  await onContactStageEntered({ organizationId, contactId: updated.id, stage: updated.stage, userId });

  revalidatePath("/embudo");

  return updated;
}

const updateContactTemperatureSchema = z.object({
  contactId: z.string().trim().min(1, "contactId es obligatorio."),
  // Nullable: pasar null limpia la temperatura ("Sin asignar").
  temperature: z.enum(contactTemperatureEnum.enumValues).nullable(),
});

export type UpdateContactTemperatureInput = z.infer<typeof updateContactTemperatureSchema>;

export async function updateContactTemperature(input: UpdateContactTemperatureInput) {
  const { organizationId, userId } = await requireActiveMembership();
  const parsed = updateContactTemperatureSchema.parse(input);

  // Aviso en vivo (sin aviso emergente) en la misma transacción.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contacts)
      .set({ temperature: parsed.temperature })
      .where(
        and(
          eq(contacts.id, parsed.contactId),
          eq(contacts.organizationId, organizationId),
        ),
      )
      .returning();
    if (row) {
      await notifyContactUpdated(tx, { organizationId, contactId: row.id, changes: ["temperatura"], by: { kind: "vendedor", userId } });
    }
    return row;
  });

  if (!updated) {
    throw new Error("Contacto no encontrado en esta organización.");
  }

  revalidatePath("/embudo");

  return updated;
}

// Autentica, valida el archivo, parsea y delega la persistencia (upsert
// idempotente por org+ghl_contact_id) en importParsedContacts, que es puro y
// testeable contra Postgres real sin la sesión. Ver las notas de estrategia de
// upsert en lib/import/persist.ts.
export async function importContactsFromCsv(
  formData: FormData,
): Promise<ImportContactsFromCsvResult> {
  // Importar en masa es de owner/admin (ACL `contact.import`); el vendedor no.
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "contact", "import")) {
    throw new Error("No tienes permiso para importar contactos; pídeselo a un administrador.");
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Sube un archivo CSV.");
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new Error("El archivo debe tener extensión .csv.");
  }

  // Guarda explícita con mensaje claro (además del bodySizeLimit del Server
  // Action en next.config.ts). 15 MB deja crecer el export de GHL muy por
  // encima de las ~10,900 filas actuales sin volverse una superficie de abuso.
  const MAX_CSV_BYTES = 15 * 1024 * 1024;
  if (file.size > MAX_CSV_BYTES) {
    throw new Error(
      `El CSV pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y supera el máximo de 15 MB.`,
    );
  }

  const csvText = await file.text();
  const parsed = parseGhlContactsCsv(csvText, await listFunnelStages(organizationId));

  if (!parsed.ok) {
    throw new Error(
      `El CSV tiene errores de formato y no se importó nada: ${parsed.errors
        .map((error) => `fila ${error.rowNumber} (${error.code}): ${error.message}`)
        .join("; ")}`,
    );
  }

  const result = await importParsedContacts(db, organizationId, parsed);

  revalidatePath("/embudo");

  return result;
}
