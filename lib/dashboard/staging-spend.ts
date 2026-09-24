// Lectura del gasto de IA de STAGING desde producción (Dashboard → Gasto de IA).
// Staging y producción usan las mismas llaves de OpenAI/Anthropic; el gasto de
// staging vive en SU base, así que producción lo pide al endpoint protegido de
// staging (app/api/internal/ai-spend). Variables (en el servicio web de producción):
//   STAGING_APP_URL  → URL pública de staging (https://…)
//   AI_SPEND_TOKEN   → el mismo valor que tiene staging
// Si faltan → "no_config"; si staging no responde a tiempo o responde raro →
// "unreachable". Nunca lanza: la tarjeta sigue mostrando producción con un aviso.
import { z } from "zod";
import type { RemoteSpend } from "./ai-spend";

const TIMEOUT_MS = 4_000;

export const spendResponseSchema = z.object({
  days: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        provider: z.string().min(1).max(40),
        usd: z.number().finite().min(0),
      }),
    )
    .max(20_000),
});

type Env = Record<string, string | undefined>;

// Solo https (o localhost en desarrollo): el token no debe viajar en claro.
function stagingUrl(base: string): URL | null {
  try {
    const url = new URL("/api/internal/ai-spend", base);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "https:" || local ? url : null;
  } catch {
    return null;
  }
}

export async function fetchStagingSpend(from: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<RemoteSpend> {
  const base = env.STAGING_APP_URL?.trim();
  const token = env.AI_SPEND_TOKEN?.trim();
  if (!base || !token) return { status: "no_config" };
  const url = stagingUrl(base);
  if (!url) {
    console.warn("[gasto-ia] STAGING_APP_URL no es una URL https válida");
    return { status: "no_config" };
  }
  url.searchParams.set("from", from);
  try {
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[gasto-ia] staging respondió ${res.status}`);
      return { status: "unreachable" };
    }
    const parsed = spendResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("[gasto-ia] respuesta de staging con formato inesperado");
      return { status: "unreachable" };
    }
    return { status: "ok", days: parsed.data.days };
  } catch (error) {
    console.warn("[gasto-ia] no se pudo leer el gasto de staging:", error instanceof Error ? error.message : error);
    return { status: "unreachable" };
  }
}
