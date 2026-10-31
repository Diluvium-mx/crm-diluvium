import "server-only";

// Lecturas que la pestaña puede juntar en un viaje (lib/inbox/lote-servidor.ts). Cada una es la Server Action
// de siempre: saca la organización de la sesión y revisa que el chat o contacto sea suyo; aquí además se
// validan sus argumentos. Solo lecturas: escribir (mandar, marcar leído, pausar…) sigue yendo por su acción.
import { z } from "zod";
import { getConversation, getConversationItems, listMessages } from "@/lib/inbox/actions";
import { getContactAgentStatus, getConversationAgent } from "@/lib/actions/agente-conversacion";
import { listScheduledMessages } from "@/lib/actions/scheduled";
import { getFollowUp } from "@/lib/actions/seguimientos";
import { getAgentActivity } from "@/lib/actions/agente-actividad";
import { getContactDetails } from "@/lib/actions/contact-qualification";
import { getLectorStatus } from "@/lib/actions/agente-lector";
import { isTemperatureFilter } from "@/lib/contacts/filters";
import type { InboxListParams } from "@/lib/inbox/types";
import { entradaLectura } from "@/lib/inbox/lote-servidor";

const id = z.string().trim().min(1).max(200);
const soloId = (args: unknown[]): [string] => [id.parse(args[0])];

const paginaMensajes = z.object({
  before: z.string().max(200).nullish(),
  limit: z.number().int().min(1).max(100).optional(),
});

const parametrosLista = z.object({
  filter: z.enum(["all", "unread", "starred"]).optional(),
  temperature: z.string().max(32).nullish(),
  search: z.string().max(500).optional(),
  searchChats: z.boolean().optional(),
});

export const LECTURAS = {
  getConversation: entradaLectura(getConversation, soloId),
  listMessages: entradaLectura(listMessages, (args): [string, z.infer<typeof paginaMensajes>] => [
    id.parse(args[0]),
    paginaMensajes.parse(args[1] ?? {}),
  ]),
  getConversationItems: entradaLectura(getConversationItems, (args): [string[], InboxListParams] => {
    const p = parametrosLista.parse(args[1] ?? {});
    return [
      z.array(id).max(100).parse(args[0]),
      { ...p, temperature: isTemperatureFilter(p.temperature) ? p.temperature : null },
    ];
  }),
  getConversationAgent: entradaLectura(getConversationAgent, soloId),
  listScheduledMessages: entradaLectura(listScheduledMessages, soloId),
  getFollowUp: entradaLectura(getFollowUp, soloId),
  getAgentActivity: entradaLectura(getAgentActivity, soloId),
  getContactDetails: entradaLectura(getContactDetails, soloId),
  getContactAgentStatus: entradaLectura(getContactAgentStatus, soloId),
  getLectorStatus: entradaLectura(getLectorStatus, soloId),
} as const;

/** Para la pestaña (solo tipos): nombre → la Server Action con sus argumentos y su respuesta. */
export type LectoresDeLote = { [N in keyof typeof LECTURAS]: (typeof LECTURAS)[N]["leer"] };
