// Cliente de prueba de staging (reglas en ./simulador.ts): crearlo si falta, escribir como él y empezar de nuevo.
// Todo filtra por organization_id y no hace nada si el simulador no está activo (producción nunca).
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, webhookEvents } from "@/lib/db/schema";
import { phoneColumns } from "@/lib/phone";
import { enqueueInbound } from "@/lib/queue/inbound";
import { webhookEventRowId } from "./index";
import { SIMULADOR, simuladorActivo, webhookDelCliente } from "./simulador";

/**
 * Deja listo el cliente de prueba de la organización: canal simulado (de prueba, con el Agente IA encendido),
 * contacto y chat con la ventana siempre abierta. Idempotente; si ya estaba, solo vuelve a abrir la ventana.
 * Devuelve el id del chat, o null si el simulador no aplica (producción u otra organización ya lo tiene).
 */
export async function asegurarClienteDePrueba(organizationId: string): Promise<string | null> {
  if (!simuladorActivo()) return null;
  const [channel] = await db.select({ organizationId: channels.organizationId }).from(channels).where(eq(channels.id, SIMULADOR.channelId)).limit(1);
  if (channel && channel.organizationId !== organizationId) return null;
  if (!channel) {
    await db
      .insert(channels)
      .values({
        id: SIMULADOR.channelId,
        organizationId,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: SIMULADOR.accountId,
        displayName: SIMULADOR.canal,
        isTest: true,
        aiAgentMode: "auto",
      })
      .onConflictDoNothing();
  }
  await db
    .insert(contacts)
    .values({ id: SIMULADOR.contactId, organizationId, firstName: SIMULADOR.nombre, ...phoneColumns(SIMULADOR.phone) })
    .onConflictDoNothing();
  await db
    .insert(conversations)
    .values({
      id: SIMULADOR.conversationId,
      organizationId,
      contactId: SIMULADOR.contactId,
      channelId: SIMULADOR.channelId,
      providerConversationId: SIMULADOR.providerConversationId,
      windowExpiresAt: SIMULADOR.ventanaHasta,
      lastMessageAt: new Date(),
    })
    .onConflictDoUpdate({ target: conversations.id, set: { windowExpiresAt: SIMULADOR.ventanaHasta } });
  return SIMULADOR.conversationId;
}

/**
 * Un mensaje del cliente de prueba: entra como un webhook de Zernio (webhook_events + cola de entrantes) y el
 * worker lo procesa igual que uno real (Agente IA, lector, workflows por palabra clave).
 */
export async function escribirComoCliente(organizationId: string, text: string): Promise<void> {
  if (!simuladorActivo()) throw new Error("El cliente de prueba solo existe en staging.");
  if ((await asegurarClienteDePrueba(organizationId)) === null) throw new Error("El cliente de prueba no está disponible en esta organización.");
  const { event, payload } = webhookDelCliente(text);
  const id = webhookEventRowId("zernio", payload.id);
  await db.insert(webhookEvents).values({ id, provider: "zernio", event, payload, organizationId });
  if (!(await enqueueInbound(id))) throw new Error("No se pudo encolar el mensaje del cliente de prueba (Redis); inténtalo de nuevo.");
}

/** Empezar de nuevo: borra el contacto de prueba (el cascade se lleva su chat, mensajes, Detalle y seguimientos) y lo vuelve a crear. */
export async function reiniciarClienteDePrueba(organizationId: string): Promise<void> {
  if (!simuladorActivo()) throw new Error("El cliente de prueba solo existe en staging.");
  await db.delete(contacts).where(and(eq(contacts.id, SIMULADOR.contactId), eq(contacts.organizationId, organizationId)));
  await asegurarClienteDePrueba(organizationId);
}
