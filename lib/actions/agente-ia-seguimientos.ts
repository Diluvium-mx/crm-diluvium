"use server";

// Server Action de la tabla de seguimientos (subpestaña «Seguimientos» de la pestaña Agente IA, Parte 4,
// 6-oct-2026). La editan los mismos roles que las Opciones (ACL: recurso `aiConfig`, `update`). La
// organización sale de la SESIÓN. Cada guardado deja su fila en el Historial (lib/followups/tabla-store.ts).
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { tableFromInput, tableToInput, type FollowUpTableInput, type TableChange } from "@/lib/followups/tabla";
import { loadLastTableChange, saveFollowUpTable } from "@/lib/followups/tabla-store";
import { logError } from "@/lib/log/safe-error";

export type FollowUpTableLastChange = { author: string | null; at: string };
export type FollowUpTableActionResult =
  | { ok: true; table: FollowUpTableInput; changes: TableChange[]; lastChange: FollowUpTableLastChange | null }
  | { ok: false; message: string };

export async function saveFollowUpTableAction(input: unknown): Promise<FollowUpTableActionResult> {
  try {
    const { organizationId, userId, role } = await requireActiveMembership();
    if (!roleAllows(role, "aiConfig", "update")) {
      return { ok: false, message: "No tienes permiso para cambiar los seguimientos del Agente IA; pídeselo a un administrador." };
    }
    const table = tableFromInput(input as FollowUpTableInput);
    const { changes } = await saveFollowUpTable(organizationId, userId, table);
    if (changes.length) console.info(`[agente-ia] tabla de seguimientos: ${changes.map((c) => `${c.title}: ${c.before ?? "—"} → ${c.after ?? "—"}`).join("; ")}`);
    const last = await loadLastTableChange(organizationId);
    revalidatePath("/agente-ia");
    return { ok: true, table: tableToInput(table), changes, lastChange: last ? { author: last.author, at: last.at.toISOString() } : null };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? "Valor no válido." };
    if (error instanceof Error && /^(No autenticado|Usuario desactivado|No tienes permiso|El usuario no tiene membresía)/.test(error.message)) {
      return { ok: false, message: error.message };
    }
    logError("[agente-ia] no se pudo guardar la tabla de seguimientos", error);
    return { ok: false, message: "No se pudo guardar la tabla; inténtalo de nuevo." };
  }
}
