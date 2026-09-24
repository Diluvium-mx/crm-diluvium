// Gasto de IA de ESTE entorno por día local (Mazatlán) y proveedor, para que el
// Dashboard de PRODUCCIÓN muestre el gasto de pruebas (staging) y lo descuente del
// saldo (mismas llaves en los dos entornos). Endpoint público protegido con
// Bearer AI_SPEND_TOKEN; responde solo sumas por día y proveedor (sin datos de
// clientes). Suma TODAS las organizaciones: es lo que consume la llave.
// SOLO existe en staging (RAILWAY_ENVIRONMENT_NAME): producción también tiene el
// token (para LLAMAR a staging), y así ese token no abre nada en producción.
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { spendByDay } from "@/lib/dashboard/ai-spend";
import { isValidDay, localToday } from "@/lib/dashboard/range";

export const dynamic = "force-dynamic";

// Tope de historia que se puede pedir (≈ 2 años).
const MAX_DAYS_BACK = 800;

function authorized(req: Request): boolean {
  const token = process.env.AI_SPEND_TOKEN?.trim();
  if (!token) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request): Promise<Response> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging") return new Response("no encontrado", { status: 404 });
  if (!authorized(req)) return new Response("no autorizado", { status: 401 });
  const from = new URL(req.url).searchParams.get("from") ?? "";
  const today = localToday();
  const oldest = new Date(Date.parse(`${today}T12:00:00Z`) - MAX_DAYS_BACK * 86_400_000).toISOString().slice(0, 10);
  if (!isValidDay(from) || from > today || from < oldest) {
    return new Response("parámetro from inválido", { status: 400 });
  }
  const days = await spendByDay(db, null, from);
  return Response.json({ days }, { headers: { "cache-control": "no-store" } });
}
