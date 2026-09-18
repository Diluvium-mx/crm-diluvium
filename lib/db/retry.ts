// Reintento acotado de una transacción ante conflictos de concurrencia de
// Postgres que se resuelven al repetir: deadlock (40P01) y fallo de
// serialización (40001). El cuerpo debe ser idempotente (lo son las
// transacciones de la mensajería: se reevalúa el estado desde la base).
const RETRYABLE = new Set(["40P01", "40001"]);
const MAX_ATTEMPTS = 5;

export async function withTxRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!code || !RETRYABLE.has(code)) throw error;
      lastError = error;
      // Espera creciente con algo de aleatorio para no volver a chocar igual.
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 20));
    }
  }
  throw lastError;
}
