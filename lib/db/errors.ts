// Postgres 23505 = choque con un índice único. Drizzle (≥0.45) envuelve el error
// del driver en DrizzleQueryError con la causa en `cause`: se revisan ambos.
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
