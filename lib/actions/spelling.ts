"use server";

// «Agregar al diccionario» del corrector ortográfico (20-oct-2026, docs/corrector.md).
// La organización sale de la sesión; cualquier rol puede agregar (decisión del dueño).
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { addTeamWord, listTeamWords } from "@/lib/spelling/store";

// Una sola palabra, solo letras (con acentos y ñ): lo mismo que el corrector subraya.
const wordSchema = z
  .string()
  .trim()
  .min(1, "La palabra está vacía.")
  .max(40, "La palabra es demasiado larga.")
  .regex(/^\p{L}+$/u, "Solo se agregan palabras sueltas, sin números ni signos.");

export async function addSpellingWord(word: string): Promise<{ wordKey: string }> {
  const { organizationId, userId, role } = await requireActiveMembership();
  if (!roleAllows(role, "spellingWord", "create")) {
    throw new Error("No tienes permiso para agregar palabras al diccionario.");
  }
  const parsed = wordSchema.parse(word);
  return { wordKey: await addTeamWord(organizationId, userId, parsed) };
}

/** Palabras del equipo, para refrescar el corrector sin recargar la página. */
export async function getSpellingWords(): Promise<string[]> {
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "spellingWord", "read")) return [];
  return listTeamWords(organizationId);
}
