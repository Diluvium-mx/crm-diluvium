// Salud de la entrada de WhatsApp para el vigilante externo (GitHub Action
// .github/workflows/inbound-monitor.yml). Endpoint público protegido con
// Bearer MONITOR_TOKEN; responde solo conteos (sin datos de clientes).
// 200 = sano · 503 = hay problemas (el cuerpo dice cuáles).
import { timingSafeEqual } from "node:crypto";
import { lockoutsLastHour } from "@/lib/auth/auth-events";
import { redis } from "@/lib/redis";
import { inboundHealth, WORKER_HEARTBEAT_KEY } from "@/lib/monitoring/inbound-health";
import { checkWhatsappAccounts, ZERNIO_WEBHOOK_KEY } from "@/lib/monitoring/account-health";
import { recordUncheckedStreak } from "@/lib/monitoring/unchecked-streak";
import type { WebhookSnapshot } from "@/lib/monitoring/status-pill";
import { logError } from "@/lib/log/safe-error";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const token = process.env.MONITOR_TOKEN;
  if (!token) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("no autorizado", { status: 401 });
  const report = await inboundHealth({
    checkZernio: true,
    heartbeatAgeSeconds: async () => {
      const value = await redis.get(WORKER_HEARTBEAT_KEY);
      return value ? Math.round((Date.now() - Number(value)) / 1000) : null;
    },
    // La cuenta se revisa aquí también (no solo en el worker): la Action no depende de él.
    whatsappAccounts: () => checkWhatsappAccounts({ source: "web" }),
    // Una falla suelta de Zernio no abre el issue: solo 2 revisiones seguidas de la Action.
    uncheckedStreak: (check, failed) => recordUncheckedStreak("web", check, failed),
    // S3: bloqueos de inicio de sesión (solo el web los ve: el login vive aquí).
    authLockouts: () => lockoutsLastHour(),
  });
  // El Dashboard muestra el webhook de Zernio que revisó esta llamada (no llama a Zernio al cargar).
  const webhook: WebhookSnapshot = { checkedAt: report.checkedAt, webhook: report.metrics.zernioWebhook };
  await redis.set(ZERNIO_WEBHOOK_KEY, JSON.stringify(webhook)).catch((error: unknown) => {
    logError("[monitor] no se pudo guardar el estado del webhook en Redis", error);
  });
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
