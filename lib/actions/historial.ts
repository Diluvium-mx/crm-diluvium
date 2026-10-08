"use server";

// Server Actions de la subpestaña "Historial" (Agente IA, Bloque A 28-sep-2026): quién
// cambió qué, antes → después y cuándo, y "Ver cambios" (Bloque E). La ven TODOS los roles
// (ACL `aiConfig:read`, como la pestaña), salvo Vendedores: solo owner/admin (`member:update`).
// La organización sale de la SESIÓN; la lectura vive en lib/historial/queries.ts.
import { ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { historyFilterSchema, historyRange, type HistoryFilter, type HistoryRow } from "@/lib/historial/labels";
import { loadChangeDiff, loadHistory } from "@/lib/historial/queries";
import type { ChangeDiff } from "@/lib/historial/diff";
import { logError } from "@/lib/log/safe-error";

export type HistoryResult = { ok: true; rows: HistoryRow[]; truncated: boolean } | { ok: false; message: string };

export async function getChangeHistory(input: HistoryFilter): Promise<HistoryResult> {
  try {
    const { organizationId, role } = await requireActiveMembership();
    if (!roleAllows(role, "aiConfig", "read")) return { ok: false, message: "No tienes permiso para ver el historial." };
    const f = historyFilterSchema.parse(input);
    const { start, end } = historyRange(f.from, f.to);
    if (start && end && start >= end) return { ok: false, message: "La fecha «Desde» debe ser antes de «Hasta»." };
    const canSeeManagerOnly = roleAllows(role, "member", "update");
    return { ok: true, ...(await loadHistory(organizationId, { type: f.type ?? null, start, end, includeAuto: f.includeAuto, canSeeManagerOnly })) };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los filtros." };
    logError("[historial] no se pudo cargar", error);
    return { ok: false, message: "No se pudo cargar el historial." };
  }
}

export type ChangeDiffResult = { ok: true; diff: ChangeDiff } | { ok: false; message: string };

export async function getChangeDiff(rowId: string): Promise<ChangeDiffResult> {
  try {
    const { organizationId, role } = await requireActiveMembership();
    if (!roleAllows(role, "aiConfig", "read")) return { ok: false, message: "No tienes permiso para ver el historial." };
    if (typeof rowId !== "string" || rowId.length > 100) return { ok: false, message: "Ese cambio no existe." };
    const diff = await loadChangeDiff(organizationId, rowId, roleAllows(role, "member", "update"));
    return diff ? { ok: true, diff } : { ok: false, message: "Este cambio no tiene detalle." };
  } catch (error) {
    logError("[historial] no se pudo cargar el detalle", error);
    return { ok: false, message: "No se pudieron cargar los cambios." };
  }
}
