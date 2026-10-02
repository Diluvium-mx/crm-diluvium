// VENTA CERRADA SOLO CON UN VENDEDOR (2-oct-2026, regla del dueño). PURO (sin BD ni red).
//
// La etapa con papel "Venta cerrada" (Compra) es anticipo o pago total, pero solo cuando un
// VENDEDOR ya revisó el comprobante y se lo confirmó al cliente en el chat, desde el CRM o
// desde el celular. La confirmación del Agente IA o de un workflow no basta: el Agente IA
// deja el aviso "Depósito recibido" (tarjeta amarilla) y el vendedor decide.
//
// El código revisa la ESTRUCTURA: después de la ÚLTIMA imagen o documento del cliente (el
// comprobante) escribió un vendedor. Qué dice ese mensaje ("Confirmo de recibido
// ✅", "Ya se reflejó su anticipo"…, varía mucho) lo juzga el modelo con la regla de la
// etapa. Sin esa estructura, el Agente IA (el que contesta y el de segundo plano) lleva al
// contacto a lo más a "Cerca de compra".
import { roleKey, type FunnelStage } from "@/lib/contacts/stages";

// Un vendedor escribe desde el CRM (`crm`; también el comando que dispara un workflow) o
// desde la app del celular (`business_app`). Igual que HUMAN_SOURCES de run.ts.
export const VENDOR_SOURCES: ReadonlySet<string> = new Set(["crm", "business_app"]);

type ChatRow = {
  direction: string;
  source: string;
  attachments: readonly { type: string }[] | null;
};

/** ¿El cliente mandó una imagen o un documento (posible comprobante)? */
export function isClientProof(m: ChatRow): boolean {
  return m.direction === "in" && (m.attachments ?? []).some((a) => a.type === "image" || a.type === "document");
}

/** ¿Escribió un vendedor (no el Agente IA ni un workflow)? */
export function isVendorMessage(m: ChatRow): boolean {
  return m.direction === "out" && VENDOR_SOURCES.has(m.source);
}

/**
 * ¿Un vendedor escribió DESPUÉS del último comprobante del cliente? (el chat en orden, del más
 * viejo al más nuevo). Es la condición para que el Agente IA pueda llevar al contacto a la
 * etapa de venta cerrada. El ÚLTIMO: una foto de la puerta con un vendedor después no
 * respalda el comprobante que llega más tarde; un comprobante nuevo espera a su vendedor.
 */
export function vendorAnsweredProof(rows: readonly ChatRow[]): boolean {
  let last = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isClientProof(rows[i])) {
      last = i;
      break;
    }
  }
  if (last < 0) return false;
  for (let i = last + 1; i < rows.length; i++) if (isVendorMessage(rows[i])) return true;
  return false;
}

/**
 * La etapa a la que el Agente IA puede llevar al contacto: la que pidió, salvo la de venta
 * cerrada sin un vendedor que haya contestado al comprobante; entonces, la de "Cerca de
 * compra" (mover solo hacia adelante lo decide moveStageForward).
 */
export function allowedAgentStage(stages: readonly FunnelStage[], requested: string | null, vendorConfirmed: boolean): string | null {
  if (requested === null || vendorConfirmed) return requested;
  if (requested !== roleKey(stages, "venta_cerrada")) return requested;
  return roleKey(stages, "cerca_compra");
}

/** Texto para el registro cuando se frenó la venta cerrada. */
export function ventaCerradaHeld(requested: string): string {
  return `etapa ${requested}: falta que un vendedor confirme el pago en el chat (después del comprobante del cliente)`;
}
