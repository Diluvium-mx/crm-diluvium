"use server";

// Server Actions de "Datos de cobro" (Configuración). Organización desde la
// SESIÓN. ACL `paymentInfo`: todos leen (el vendedor coteja un depósito), solo
// owner/admin editan. La CLABE completa solo se devuelve a quien puede editar.
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { datosCobro } from "@/lib/db/schema/cobro";
import { clabeMasked, datosCobroSchema, type DatosCobroInput } from "@/lib/cobro/datos-cobro";

export type DatosCobroView = DatosCobroInput & {
  /** "•••• 1234" para quien no puede editar; la CLABE completa va en `clabe` solo si canEdit. */
  clabeMasked: string;
  canEdit: boolean;
  updatedAt: string | null;
};

const EMPTY: DatosCobroInput = { banco: "", beneficiario: "", clabe: "", cuenta: "", concepto: "", notas: "" };

export async function getDatosCobro(): Promise<DatosCobroView> {
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "paymentInfo", "read")) throw new Error("Sin permiso.");
  const canEdit = roleAllows(role, "paymentInfo", "update");
  const [row] = await db.select().from(datosCobro).where(eq(datosCobro.organizationId, organizationId)).limit(1);
  const data: DatosCobroInput = row
    ? { banco: row.banco, beneficiario: row.beneficiario, clabe: row.clabe, cuenta: row.cuenta, concepto: row.concepto, notas: row.notas }
    : EMPTY;
  return {
    ...data,
    clabe: canEdit ? data.clabe : "",
    clabeMasked: clabeMasked(data.clabe),
    // La cuenta/tarjeta también va enmascarada para quien no edita (solo los últimos 4).
    cuenta: canEdit ? data.cuenta : data.cuenta ? `•••• ${data.cuenta.slice(-4)}` : "",
    canEdit,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function saveDatosCobro(input: DatosCobroInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId, role, userId } = await requireActiveMembership();
  if (!roleAllows(role, "paymentInfo", "update")) return { ok: false, error: "Solo owner/admin pueden cambiar los datos de cobro." };
  const parsed = datosCobroSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  const now = new Date();
  await db
    .insert(datosCobro)
    .values({ organizationId, ...parsed.data, updatedByUserId: userId, updatedAt: now })
    .onConflictDoUpdate({ target: datosCobro.organizationId, set: { ...parsed.data, updatedByUserId: userId, updatedAt: now } });
  revalidatePath("/configuracion");
  return { ok: true };
}
