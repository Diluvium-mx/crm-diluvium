// Siembra los rangos de tallas por defecto (A7) de una organización. La usa el
// hook de creación de organizaciones (lib/auth/index.ts); las que ya existían
// los recibieron con la migración 0018. Idempotente por (org, línea, talla).
import type { db as appDb } from "@/lib/db";
import { tallasCompuerta } from "@/lib/db/schema/qualification";
import { DEFAULT_SIZE_RANGES } from "./sizes";

export async function seedDefaultSizeRanges(database: Pick<typeof appDb, "insert">, organizationId: string): Promise<void> {
  await database
    .insert(tallasCompuerta)
    .values(DEFAULT_SIZE_RANGES.map((range) => ({ id: crypto.randomUUID(), organizationId, ...range })))
    .onConflictDoNothing();
}
