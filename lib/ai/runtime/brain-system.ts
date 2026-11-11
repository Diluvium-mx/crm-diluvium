// System del cerebro (Goal + FAQs con los valores personalizados sustituidos + TAMAÑOS de Tallas y medidas +
// sufijo del CRM + etapas + links de pago), en dos partes para la caché (brain.ts › buildBrainSystemParts). UN solo armado para las respuestas (run.ts) y para la renovación de la caché
// (cache-keepalive.ts): si los dos no mandan exactamente lo mismo, la renovación escribiría
// otra entrada de caché en vez de mantener viva la de las respuestas.
import type { ResponseLength } from "@/lib/agente-ia/opciones";
import { applyCustomValues, type CustomValues } from "@/lib/agente-ia/editor";
import { asc, eq } from "drizzle-orm";
import type { SizeRange } from "@/lib/contacts/sizes";
import { db } from "@/lib/db";
import { tallasCompuerta } from "@/lib/db/schema";
import type { FunnelStage } from "@/lib/contacts/stages";
import { linksDelAgente, opcionesDe } from "@/lib/agente-ia/links-pago";
import { listLinksPago } from "@/lib/agente-ia/links-pago-store";
import { buildBrainSystemParts, type BrainSystem } from "./brain";
import { loadEnabledFaqs } from "./config";

export async function loadBrainSystem(
  organizationId: string,
  goal: string,
  values: CustomValues,
  stages: readonly FunnelStage[],
  responseLength: ResponseLength,
): Promise<BrainSystem> {
  const [enabledFaqs, sizes, links] = await Promise.all([loadEnabledFaqs(organizationId), loadSizeRanges(organizationId), listLinksPago(organizationId)]);
  const faqs = enabledFaqs.map((f) => ({
    ...f,
    question: applyCustomValues(f.question, values),
    answer: applyCustomValues(f.answer, values),
  }));
  // Las mismas opciones que la herramienta enviar_link_pago (loadAgentTools en actions.ts).
  return buildBrainSystemParts(applyCustomValues(goal, values), faqs, stages, responseLength, sizes, opcionesDe(linksDelAgente(links)));
}

// Los rangos de Tallas y medidas (los mismos que dan el tamaño sugerido del Detalle).
async function loadSizeRanges(organizationId: string): Promise<SizeRange[]> {
  return db
    .select({ linea: tallasCompuerta.linea, talla: tallasCompuerta.talla, minCm: tallasCompuerta.minCm, maxCm: tallasCompuerta.maxCm, posicion: tallasCompuerta.posicion })
    .from(tallasCompuerta)
    .where(eq(tallasCompuerta.organizationId, organizationId))
    .orderBy(asc(tallasCompuerta.linea), asc(tallasCompuerta.posicion));
}
