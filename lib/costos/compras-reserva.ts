// Compras de crédito de los modelos de reserva (xAI, OpenRouter y Google) para el renglón «IA · (xAI, OpenRouter y
// Google)» del costo del CRM (decisión del dueño 27-nov-2026, lib/costos/mes.ts › renglonReserva). Salen de las
// recargas que se registran en Dashboard › Gasto de IA (ai_credit_topups, día en hora de Mazatlán). Solo lee.
import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { aiCreditTopups } from "@/lib/db/schema";
import { type CompraIa, IA_RESERVA } from "./mes";

type Database = Pick<typeof appDb, "select">;

export async function cargarComprasReserva(database: Database, organizationId: string): Promise<CompraIa[]> {
  return database
    .select({ provider: aiCreditTopups.provider, amountUsd: aiCreditTopups.amountUsd, toppedUpOn: aiCreditTopups.toppedUpOn })
    .from(aiCreditTopups)
    .where(and(eq(aiCreditTopups.organizationId, organizationId), inArray(aiCreditTopups.provider, IA_RESERVA)));
}
