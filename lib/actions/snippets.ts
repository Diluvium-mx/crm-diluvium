"use server";

// Server Actions de Fragmentos (snippets). Resuelven la organización activa
// desde la SESIÓN (nunca del cliente) y acotan toda lectura/escritura a esa
// organización (CLAUDE.md §7). Los fragmentos son a nivel organización: todos
// los miembros ven y editan los mismos (igual criterio que Contactos, §5).
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { snippets } from "@/lib/db/schema/snippets";
import { extractVariables } from "@/lib/snippets/variables";
import type { SnippetView } from "@/lib/snippets/types";

const NAME_MAX = 60;
const BODY_MAX = 2000; // respuesta reutilizable, no un documento

const nameSchema = z.string().trim().min(1, "El nombre es obligatorio.").max(NAME_MAX, `El nombre no puede pasar de ${NAME_MAX} caracteres.`);
const bodySchema = z.string().trim().min(1, "El fragmento no puede estar vacío.").max(BODY_MAX, `El fragmento no puede pasar de ${BODY_MAX} caracteres.`);

const createSnippetSchema = z.object({ name: nameSchema, body: bodySchema });
const updateSnippetSchema = z.object({
  id: z.string().trim().min(1, "id es obligatorio."),
  name: nameSchema,
  body: bodySchema,
});

export type CreateSnippetInput = z.infer<typeof createSnippetSchema>;
export type UpdateSnippetInput = z.infer<typeof updateSnippetSchema>;

function toView(row: typeof snippets.$inferSelect): SnippetView {
  return { id: row.id, name: row.name, body: row.body, variables: row.variables };
}

// Los fragmentos son configuración compartida de la organización: cualquier
// miembro los LEE y los inserta en el chat, pero solo quien tenga el permiso
// `snippet` de gestión (owner/admin en lib/auth/permissions.ts) los crea, edita
// o borra. En v1 el agente es de solo lectura sobre fragmentos.
function requireSnippetManage(role: string, action: "create" | "update" | "delete"): void {
  if (!roleAllows(role, "snippet", action)) {
    throw new Error("No tienes permiso para gestionar fragmentos; pídeselo a un administrador.");
  }
}

// Postgres 23505 = choque con el índice único (organización, nombre).
function isDuplicateName(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export async function listSnippets(): Promise<SnippetView[]> {
  const { organizationId } = await requireActiveMembership();
  const rows = await db
    .select()
    .from(snippets)
    .where(eq(snippets.organizationId, organizationId))
    .orderBy(asc(snippets.name));
  return rows.map(toView);
}

export async function createSnippet(input: CreateSnippetInput): Promise<SnippetView> {
  const { organizationId, role } = await requireActiveMembership();
  requireSnippetManage(role, "create");
  const parsed = createSnippetSchema.parse(input);
  try {
    const [created] = await db
      .insert(snippets)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        name: parsed.name,
        body: parsed.body,
        variables: extractVariables(parsed.body),
      })
      .returning();
    revalidatePath("/snippets");
    return toView(created);
  } catch (error) {
    if (isDuplicateName(error)) throw new Error(`Ya existe un fragmento llamado "${parsed.name}".`);
    throw error;
  }
}

export async function updateSnippet(input: UpdateSnippetInput): Promise<SnippetView> {
  const { organizationId, role } = await requireActiveMembership();
  requireSnippetManage(role, "update");
  const parsed = updateSnippetSchema.parse(input);
  try {
    const [updated] = await db
      .update(snippets)
      .set({
        name: parsed.name,
        body: parsed.body,
        variables: extractVariables(parsed.body),
        updatedAt: new Date(),
      })
      .where(and(eq(snippets.id, parsed.id), eq(snippets.organizationId, organizationId)))
      .returning();
    if (!updated) throw new Error("Fragmento no encontrado en esta organización.");
    revalidatePath("/snippets");
    return toView(updated);
  } catch (error) {
    if (isDuplicateName(error)) throw new Error(`Ya existe un fragmento llamado "${parsed.name}".`);
    throw error;
  }
}

export async function deleteSnippet(id: string): Promise<void> {
  const { organizationId, role } = await requireActiveMembership();
  requireSnippetManage(role, "delete");
  const cleanId = z.string().trim().min(1).parse(id);
  const [deleted] = await db
    .delete(snippets)
    .where(and(eq(snippets.id, cleanId), eq(snippets.organizationId, organizationId)))
    .returning({ id: snippets.id });
  if (!deleted) throw new Error("Fragmento no encontrado en esta organización.");
  revalidatePath("/snippets");
}
