"use server";

// Recargas de crédito de los proveedores de IA (tarjeta "Gasto de IA" del Dashboard).
// Todos los roles (ACL: recurso `aiSpend`, acción `update`; el vendedor también desde
// el 26-sep-2026). La organización sale
// de la SESIÓN. El saldo que se muestra es un ESTIMADO (lib/dashboard/ai-spend.ts).
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { aiCreditTopups } from "@/lib/db/schema";
import { PROVIDER_META } from "@/lib/ai/provider";
import { localToday } from "@/lib/dashboard/range";
import { idSchema } from "@/lib/agente-ia/settings";
import type { AgentActionResult } from "@/lib/agente-ia/types";
import { logError } from "@/lib/log/safe-error";

const topupSchema = z.object({
  provider: z.string().refine((p) => p in PROVIDER_META, { message: "Proveedor no válido." }),
  amountUsd: z.number().positive("El monto debe ser mayor a 0.").max(100_000, "Monto demasiado alto."),
  toppedUpOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.")
    .refine((d) => !Number.isNaN(Date.parse(`${d}T12:00:00Z`)), { message: "Fecha no válida." })
    .refine((d) => d <= localToday(), { message: "La fecha no puede ser futura." }),
});

async function run(fallback: string, fn: (m: { organizationId: string; userId: string }) => Promise<void>): Promise<AgentActionResult> {
  try {
    const m = await requireActiveMembership();
    if (!roleAllows(m.role, "aiSpend", "update")) return { ok: false, message: "No tienes permiso para registrar recargas." };
    await fn(m);
    revalidatePath("/inicio");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? fallback };
    logError(`[gasto-ia] ${fallback}`, error);
    return { ok: false, message: fallback };
  }
}

export async function addAiTopup(input: { provider: string; amountUsd: number; toppedUpOn: string }): Promise<AgentActionResult> {
  return run("No se pudo registrar la recarga.", async ({ organizationId, userId }) => {
    const parsed = topupSchema.parse(input);
    await db.insert(aiCreditTopups).values({
      id: crypto.randomUUID(),
      organizationId,
      provider: parsed.provider,
      amountUsd: Math.round(parsed.amountUsd * 100) / 100,
      toppedUpOn: parsed.toppedUpOn,
      createdByUserId: userId,
    });
  });
}

export async function deleteAiTopup(input: { id: string }): Promise<AgentActionResult> {
  return run("No se pudo borrar la recarga.", async ({ organizationId }) => {
    await db.delete(aiCreditTopups).where(and(eq(aiCreditTopups.id, idSchema.parse(input.id)), eq(aiCreditTopups.organizationId, organizationId)));
  });
}
