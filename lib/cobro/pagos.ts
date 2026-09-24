// Pagos confirmados: consulta y registro (parte con BD del comprobante). El
// agente (parte b) llama `contextoParaComprobante` → `verificarComprobante` →
// `registrarPagoConfirmado`; el registro es atómico por referencia (índice único).
import { and, eq, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, pagosConfirmados } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";

import { normalizarReferencia } from "./comprobante";

export { normalizarReferencia };

/** Conversación donde ya se confirmó esa referencia (null si no existe). */
export async function conversacionDeReferencia(organizationId: string, referencia: string): Promise<string | null> {
  const [row] = await db
    .select({ conversationId: pagosConfirmados.conversationId })
    .from(pagosConfirmados)
    .where(and(eq(pagosConfirmados.organizationId, organizationId), eq(pagosConfirmados.referencia, normalizarReferencia(referencia))))
    .limit(1);
  return row ? row.conversationId : null;
}

export async function referenciaYaUsada(organizationId: string, referencia: string): Promise<boolean> {
  const [row] = await db
    .select({ id: pagosConfirmados.id })
    .from(pagosConfirmados)
    .where(and(eq(pagosConfirmados.organizationId, organizationId), eq(pagosConfirmados.referencia, normalizarReferencia(referencia))))
    .limit(1);
  return Boolean(row);
}

/** Anticipos ya confirmados en la conversación (MXN). */
export async function anticipoConfirmado(organizationId: string, conversationId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(pagosConfirmados.montoMxn) })
    .from(pagosConfirmados)
    .where(
      and(
        eq(pagosConfirmados.organizationId, organizationId),
        eq(pagosConfirmados.conversationId, conversationId),
        eq(pagosConfirmados.tipo, "anticipo"),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Lo que necesita `verificarComprobante` además de la lectura de la foto. */
export async function contextoParaComprobante(organizationId: string, conversationId: string, contactId: string, referencia: string | null) {
  const [c] = await db
    .select({ monto: contacts.montoCotizacion, customFields: contacts.customFields })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  return {
    totalCotizado: c?.monto != null ? Number(c.monto) : null,
    // "agente" | "vendedor" | null: quién fijó el total (para el aviso al vendedor).
    cotizacionPor: (() => {
      const v = (c?.customFields as Record<string, unknown> | undefined)?.cotizacion_por;
      return typeof v === "string" ? v : null;
    })(),
    anticipoConfirmado: await anticipoConfirmado(organizationId, conversationId),
    referenciaYaUsada: referencia ? await referenciaYaUsada(organizationId, referencia) : false,
    hoy: new Date(),
  };
}

export class ReferenciaDuplicadaError extends Error {}

export async function registrarPagoConfirmado(input: {
  organizationId: string;
  conversationId: string | null;
  contactId: string | null;
  referencia: string;
  montoMxn: number;
  tipo: "completo" | "anticipo" | "liquidacion";
  banco: string | null;
  fechaComprobante: string | null;
  confirmadoPor: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  try {
    // created_at desde JS (no default now() de la BD): se compara con created_at de
    // `messages`, que también se escribe desde JS (mismo reloj y misma zona).
    await db.insert(pagosConfirmados).values({ ...input, id, referencia: normalizarReferencia(input.referencia), createdAt: new Date() });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ReferenciaDuplicadaError(`la referencia ${input.referencia} ya está registrada`);
    throw error;
  }
  return id;
}
