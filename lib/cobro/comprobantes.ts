// Comprobantes leídos por el agente: registro mínimo, chequeo silencioso de
// referencia repetida y resumen para el contexto del agente. Sin reglas de monto:
// el agente decide con su Goal. Multi-tenant: todo filtra por organization_id.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { comprobantes, contacts } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";

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

export type ReferenciaRepetida = { contactName: string; fecha: Date; mismoContacto: boolean };

/**
 * Chequeo silencioso: ¿esta referencia ya se registró en la organización?
 * Mismo contacto (reenvió la misma foto) → `mismoContacto: true` (no es repetida).
 * Otro contacto → datos para el aviso "⚠ Referencia ya usada con …".
 */
export async function referenciaRepetida(organizationId: string, contactId: string, referencia: string): Promise<ReferenciaRepetida | null> {
  const norm = normalizarReferencia(referencia);
  if (norm.length < 4) return null;
  const rows = await db
    .select({ contactId: comprobantes.contactId, createdAt: comprobantes.createdAt, name: contacts.firstName, last: contacts.lastName })
    .from(comprobantes)
    .leftJoin(contacts, eq(contacts.id, comprobantes.contactId))
    .where(and(eq(comprobantes.organizationId, organizationId), eq(comprobantes.referenciaNorm, norm)))
    .orderBy(desc(comprobantes.createdAt))
    .limit(5);
  if (rows.length === 0) return null;
  const mismo = rows.find((r) => r.contactId === contactId);
  if (mismo) return { contactName: [mismo.name, mismo.last].filter(Boolean).join(" "), fecha: mismo.createdAt, mismoContacto: true };
  const otro = rows[0];
  return { contactName: [otro.name, otro.last].filter(Boolean).join(" ").trim() || "otro contacto", fecha: otro.createdAt, mismoContacto: false };
}

/** Registra lo leído. Idempotente por mensaje del cliente (índice único). */
export async function registrarComprobante(input: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  messageId: string | null;
  lectura: ComprobanteLeido;
}): Promise<"registrado" | "ya_existia"> {
  try {
    await db.insert(comprobantes).values({
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
    });
    return "registrado";
  } catch (error) {
    if (isUniqueViolation(error)) return "ya_existia";
    throw error;
  }
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
