// Salud de la entrada de WhatsApp para el vigilante externo (GitHub Action
// .github/workflows/inbound-monitor.yml). Endpoint público protegido con
// Bearer MONITOR_TOKEN; responde solo conteos (sin datos de clientes).
// 200 = sano · 503 = hay problemas (el cuerpo dice cuáles).
import { timingSafeEqual } from "node:crypto";
import { redis } from "@/lib/redis";
import { inboundHealth, WORKER_HEARTBEAT_KEY } from "@/lib/monitoring/inbound-health";

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
    heartbeatAgeSeconds: async () => {
      const value = await redis.get(WORKER_HEARTBEAT_KEY);
      return value ? Math.round((Date.now() - Number(value)) / 1000) : null;
    },
  });
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
