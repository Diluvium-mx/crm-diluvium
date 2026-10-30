// Cliente de prueba de STAGING (30-oct-2026, pedido del dueño; docs/staging.md › Cliente de prueba): un contacto
// fijo, «Cliente de prueba», en un canal simulado que nunca toca WhatsApp. Su ventana de 24 h siempre está
// abierta (nunca pide plantilla) y en su chat hay una caja para escribir COMO el cliente: el mensaje entra por el
// mismo camino que un webhook de Zernio (webhook_events + cola de entrantes), así que el Agente IA, el lector,
// los workflows y los seguimientos se comportan igual que con un cliente real. Lo que se le manda a ese contacto
// (vendedor, Agente IA, workflows) se marca como enviado sin llamar a Zernio.
// Solo existe donde `simuladorActivo()`: staging en Railway, o desarrollo/pruebas locales. En producción nunca.
import type { MessagingProvider, SendResult } from "./provider";

export const SIMULADOR = {
  accountId: "sim_cliente_prueba",
  channelId: "ch_simulador",
  contactId: "contact_simulador",
  conversationId: "conv_simulador",
  providerConversationId: "zconv_simulador",
  // Lada de Los Mochis con un número que no existe (los números de México no empiezan con 0 tras la lada).
  phone: "+526680000000",
  nombre: "Cliente de prueba",
  canal: "Simulador (staging)",
  // La ventana nunca cierra: el composer nunca pide plantilla.
  ventanaHasta: new Date("2100-01-01T00:00:00Z"),
} as const;

/** ¿Hay cliente simulado en este entorno? Staging en Railway o local sin Railway (dev/pruebas); producción nunca. */
export function simuladorActivo(env: Record<string, string | undefined> = process.env): boolean {
  const railway = env.RAILWAY_ENVIRONMENT_NAME;
  if (railway) return railway === "staging";
  return env.NODE_ENV !== "production";
}

export function esCuentaSimulada(providerAccountId: string | null | undefined): boolean {
  return providerAccountId === SIMULADOR.accountId;
}

const simulado = (): SendResult => {
  const id = crypto.randomUUID();
  return { providerInternalId: `sim_${id}`, providerMessageId: `wamid.sim.${id}` };
};

/**
 * El proveedor de siempre, salvo para la cuenta del simulador con el simulador activo: ahí el envío se da por
 * hecho sin red (texto, plantilla o archivo). Fuera de staging la cuenta simulada no tiene nada especial: Zernio
 * la rechazaría (no existe).
 */
export function conSimulador(provider: MessagingProvider): MessagingProvider {
  const intercept = <I extends { providerAccountId: string }>(send: (input: I) => Promise<SendResult>) =>
    (input: I): Promise<SendResult> => (esCuentaSimulada(input.providerAccountId) && simuladorActivo() ? Promise.resolve(simulado()) : send(input));
  return Object.assign(Object.create(provider) as MessagingProvider, {
    sendText: intercept(provider.sendText.bind(provider)),
    sendTemplate: intercept(provider.sendTemplate.bind(provider)),
    sendMedia: intercept(provider.sendMedia.bind(provider)),
  });
}

/** Payload con la forma de un webhook de Zernio para un mensaje del cliente simulado (lo procesa ingest.ts). */
export function webhookDelCliente(text: string, at: Date = new Date()): { event: string; payload: Record<string, unknown> & { id: string } } {
  const n = crypto.randomUUID();
  const digits = SIMULADOR.phone.replace(/\D/g, "");
  const iso = at.toISOString();
  const payload = {
    id: `evt_sim_${n}`,
    event: "message.received",
    timestamp: iso,
    message: {
      id: `zmsg_sim_${n}`,
      conversationId: SIMULADOR.providerConversationId,
      platform: "whatsapp",
      platformMessageId: `wamid.sim.in.${n}`,
      direction: "incoming",
      text,
      attachments: [],
      sender: { id: digits, name: SIMULADOR.nombre, phoneNumber: digits },
      sentAt: iso,
    },
    conversation: { id: SIMULADOR.providerConversationId, participantId: digits, participantName: SIMULADOR.nombre },
    account: { id: SIMULADOR.accountId, platform: "whatsapp" },
  };
  return { event: "message.received", payload };
}
