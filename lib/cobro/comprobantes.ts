// Comprobantes leídos por el agente: registro mínimo, chequeo silencioso de
// referencia repetida y resumen para el contexto del agente. Sin reglas de monto:
// el agente decide con su Goal. Multi-tenant: todo filtra por organization_id.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";

type Tx = Pick<typeof db, "select" | "insert" | "execute">;

// Serializa el chequeo + registro por (organización, referencia): dos contactos
// con la misma referencia al mismo tiempo no se cuelan sin el ⚠.
export async function conCandadoDeReferencia<T>(organizationId: string, referencia: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (referencia) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${normalizarReferencia(referencia)}`}))`);
    return fn(tx as unknown as Tx);
  });
}
import { comprobantes, contacts } from "@/lib/db/schema";

export type ComprobanteTipo = "total" | "anticipo" | "resto";

export function normalizarReferencia(ref: string): string {
  return ref.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type ComprobanteLeido = {
  monto: string | null;
  referencia: string | null;
  banco: string | null;
  fecha: string | null;
  tipo: ComprobanteTipo | null;
};

export type ReferenciaRepetida = { contactName: string; fecha: Date; mismoContacto: boolean; messageId: string | null; monto: string | null };

// "$5,500.00", "5500" y "5,500" son el mismo monto.
export function montoNorm(m: string | null): string {
  if (!m) return "";
  const n = Number(m.replace(/[^\d.,]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : m.trim();
}

/**
 * Chequeo silencioso: ¿esta referencia ya se registró en la organización?
 * Mismo contacto (reenvió la misma foto) → `mismoContacto: true` (no es repetida).
 * Otro contacto → datos para el aviso "⚠ Referencia ya usada con …".
 */
export async function referenciaRepetida(organizationId: string, contactId: string, referencia: string, tx: Tx = db): Promise<ReferenciaRepetida | null> {
  const norm = normalizarReferencia(referencia);
  if (norm.length < 4) return null;
  const rows = await tx
    .select({ contactId: comprobantes.contactId, createdAt: comprobantes.createdAt, messageId: comprobantes.messageId, monto: comprobantes.monto, name: contacts.firstName, last: contacts.lastName })
    .from(comprobantes)
    .leftJoin(contacts, eq(contacts.id, comprobantes.contactId))
    .where(and(eq(comprobantes.organizationId, organizationId), eq(comprobantes.referenciaNorm, norm)))
    .orderBy(desc(comprobantes.createdAt))
    .limit(5);
  if (rows.length === 0) return null;
  // Otro contacto tiene prioridad: aunque este contacto ya la tenga, el ⚠ sale.
  const otro = rows.find((r) => r.contactId !== contactId);
  if (otro) return { contactName: [otro.name, otro.last].filter(Boolean).join(" ").trim() || "otro contacto", fecha: otro.createdAt, mismoContacto: false, messageId: otro.messageId, monto: otro.monto };
  const mismo = rows[0];
  return { contactName: [mismo.name, mismo.last].filter(Boolean).join(" "), fecha: mismo.createdAt, mismoContacto: true, messageId: mismo.messageId, monto: mismo.monto };
}

/** Registra lo leído. Idempotente por mensaje del cliente (índice único). */
export async function registrarComprobante(input: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  messageId: string | null;
  lectura: ComprobanteLeido;
}, tx: Tx = db): Promise<"registrado" | "ya_existia"> {
  // Sin try/catch: dentro de una transacción un error abortaría todo; el índice
  // único por mensaje decide (un reintento del job devuelve "ya_existia").
  const rows = await tx
    .insert(comprobantes)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      monto: input.lectura.monto,
      referencia: input.lectura.referencia,
      referenciaNorm: input.lectura.referencia ? normalizarReferencia(input.lectura.referencia) : null,
      banco: input.lectura.banco,
      fechaComprobante: input.lectura.fecha,
      tipo: input.lectura.tipo,
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: comprobantes.messageId })
    .returning({ id: comprobantes.id });
  return rows.length ? "registrado" : "ya_existia";
}

/** Comprobantes ya registrados del contacto (para el contexto del agente), del más viejo al más nuevo. */
export async function comprobantesDelContacto(organizationId: string, contactId: string, limit = 10) {
  const rows = await db
    .select({ monto: comprobantes.monto, tipo: comprobantes.tipo, fecha: comprobantes.fechaComprobante, createdAt: comprobantes.createdAt, referencia: comprobantes.referencia })
    .from(comprobantes)
    .where(and(eq(comprobantes.organizationId, organizationId), eq(comprobantes.contactId, contactId)))
    .orderBy(desc(comprobantes.createdAt))
    .limit(limit);
  return rows.reverse();
}
