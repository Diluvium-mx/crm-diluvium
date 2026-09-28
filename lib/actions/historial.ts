"use server";

// Server Action de la subpestaña "Historial" (Agente IA, Bloque A 28-sep-2026): quién
// cambió qué, antes → después y cuándo. La ven TODOS los roles (ACL `aiConfig:read`, como
// la pestaña). La organización sale de la SESIÓN; la lectura vive en lib/historial/queries.ts.
import { ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { historyFilterSchema, historyRange, type HistoryFilter, type HistoryRow } from "@/lib/historial/labels";
import { loadHistory } from "@/lib/historial/queries";

export type HistoryResult = { ok: true; rows: HistoryRow[]; truncated: boolean } | { ok: false; message: string };

export async function getChangeHistory(input: HistoryFilter): Promise<HistoryResult> {
  try {
    const { organizationId, role } = await requireActiveMembership();
    if (!roleAllows(role, "aiConfig", "read")) return { ok: false, message: "No tienes permiso para ver el historial." };
    const f = historyFilterSchema.parse(input);
    const { start, end } = historyRange(f.from, f.to);
    if (start && end && start >= end) return { ok: false, message: "La fecha «Desde» debe ser antes de «Hasta»." };
    return { ok: true, ...(await loadHistory(organizationId, { type: f.type ?? null, start, end, includeAuto: f.includeAuto })) };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los filtros." };
    console.error("[historial] no se pudo cargar", error);
    return { ok: false, message: "No se pudo cargar el historial." };
  }
}
