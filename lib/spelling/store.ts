import "server-only";

// Diccionario del equipo (tabla `spelling_words`), siempre acotado a la organización.
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spellingWords } from "@/lib/db/schema/spelling";
import { customWordKey } from "./rules";

/** Palabras del equipo, en minúsculas (así las compara el corrector). */
export async function listTeamWords(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ wordKey: spellingWords.wordKey })
    .from(spellingWords)
    .where(eq(spellingWords.organizationId, organizationId))
    .orderBy(asc(spellingWords.wordKey));
  return rows.map((r) => r.wordKey);
}

/** Agrega la palabra; si ya estaba (con cualquier mayúscula) no hace nada. */
export async function addTeamWord(organizationId: string, userId: string, word: string): Promise<string> {
  const wordKey = customWordKey(word);
  await db
    .insert(spellingWords)
    .values({ id: crypto.randomUUID(), organizationId, word: word.trim(), wordKey, createdBy: userId })
    .onConflictDoNothing({ target: [spellingWords.organizationId, spellingWords.wordKey] });
  return wordKey;
}
