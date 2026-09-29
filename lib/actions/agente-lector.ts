"use server";

// Server Action de SOLO LECTURA para el indicador del Detalle: ¿qué está haciendo el Agente
// IA en segundo plano con este contacto? (en espera / leyendo / al día / error). La
// organización sale de la SESIÓN y el lector solo mira chats de esa organización. Nunca
// lanza: si algo falla, el indicador no se muestra y el Detalle sigue igual.
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { loadLectorStatus, type LectorStatusView } from "@/lib/agente-ia/lector-status-store";

const contactIdSchema = z.string().trim().min(1).max(200);

export async function getLectorStatus(contactId: string): Promise<LectorStatusView | null> {
  try {
    const { organizationId } = await requireActiveMembership();
    return await loadLectorStatus(organizationId, contactIdSchema.parse(contactId), new Date());
  } catch {
    return null;
  }
}
