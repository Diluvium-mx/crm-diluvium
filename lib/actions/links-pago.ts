"use server";

// Server Action de Agente IA › Links de pago (30-oct-2026; reglas en lib/agente-ia/links-pago.ts).
// La editan vendedores, admin y owner, como todo lo de la pestaña Agente IA (ACL: `aiConfig`,
// `update`); cada guardado queda en el Historial con quién lo cambió. La organización sale de la SESIÓN.
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import type { LinkPago } from "@/lib/agente-ia/links-pago";
import { replaceLinksPago } from "@/lib/agente-ia/links-pago-store";
import { logError } from "@/lib/log/safe-error";

export type LinksPagoActionResult = { ok: true; links: LinkPago[] } | { ok: false; message: string };

export async function saveLinksPago(input: unknown): Promise<LinksPagoActionResult> {
  try {
    const { organizationId, userId, role } = await requireActiveMembership();
    if (!roleAllows(role, "aiConfig", "update")) {
      return { ok: false, message: "No tienes permiso para cambiar los links de pago; pídeselo a un administrador." };
    }
    if (!Array.isArray(input)) return { ok: false, message: "Lista de links no válida." };
    const links = await replaceLinksPago(organizationId, input, userId);
    revalidatePath("/agente-ia");
    return { ok: true, links };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? "Valor no válido." };
    if (error instanceof Error && /^(No autenticado|Usuario desactivado|No tienes permiso|El usuario no tiene membresía)/.test(error.message)) {
      return { ok: false, message: error.message };
    }
    logError("[agente-ia] no se pudieron guardar los links de pago", error);
    return { ok: false, message: "No se pudieron guardar los links; inténtalo de nuevo." };
  }
}
