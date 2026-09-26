"use server";

// Server Action de las Opciones del bot (sección "Opciones" de la pestaña Agente IA,
// 26-sep-2026). La editan vendedores, admin y owner (ACL: recurso `aiConfig`, `update`).
// La organización sale de la SESIÓN. Cada guardado registra quién cambió qué y cuándo.
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { botOptionsPatchSchema } from "@/lib/agente-ia/opciones";
import { loadLastOptionsChange, saveBotOptions } from "@/lib/agente-ia/opciones-store";
import type { OptionsActionResult } from "@/lib/agente-ia/types";

export async function updateBotOptions(input: unknown): Promise<OptionsActionResult> {
  try {
    const { organizationId, userId, role } = await requireActiveMembership();
    if (!roleAllows(role, "aiConfig", "update")) {
      return { ok: false, message: "No tienes permiso para cambiar las opciones del bot; pídeselo a un administrador." };
    }
    const patch = botOptionsPatchSchema.parse(input);
    const { options, changes } = await saveBotOptions(organizationId, userId, patch);
    if (changes.length) console.info(`[agente-ia] opciones del bot: ${changes.map((c) => `${c.field}: ${c.oldValue} → ${c.newValue}`).join("; ")}`);
    const last = await loadLastOptionsChange(organizationId);
    revalidatePath("/agente-ia");
    return { ok: true, options, lastChange: last ? { ...last, createdAt: last.createdAt.toISOString() } : null };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? "Valor no válido." };
    // Sesión vencida, usuario desactivado o sin membresía: se dice tal cual (no es una falla
    // del servidor y no va al log de errores), igual que en el editor del agente.
    if (error instanceof Error && /^(No autenticado|Usuario desactivado|No tienes permiso|El usuario no tiene membresía)/.test(error.message)) {
      return { ok: false, message: error.message };
    }
    console.error("[agente-ia] no se pudieron guardar las opciones del bot", error);
    return { ok: false, message: "No se pudo guardar la opción; inténtalo de nuevo." };
  }
}
