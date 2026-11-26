// Respuesta del formulario público de opinión (/opinion/<token>, docs/opiniones.md).
// Sin sesión: el cliente no tiene usuario. Lo que autoriza es el token del enlace
// (128 bits al azar, una sola respuesta, vence a los 60 días). Límite por IP para que
// nadie la use de buzón.
import { ipRateLimiter } from "@/lib/rate-limit";
import { sesionEsSoloLectura } from "@/lib/auth/active-organization";
import { SOLO_LECTURA_HEADER, SOLO_LECTURA_MENSAJE } from "@/lib/auth/solo-lectura";
import { logError } from "@/lib/log/safe-error";
import { respuestaSchema } from "@/lib/opiniones/respuestas";
import { responderOpinion, type ResultadoRespuesta } from "@/lib/opiniones/store";

export const dynamic = "force-dynamic";

const RULES = [{ name: "opinion", max: 20, windowMs: 10 * 60_000 }];
const MAX_BYTES = 8_192;

const RESPUESTAS: Record<Exclude<ResultadoRespuesta, "ok">, { status: number; message: string }> = {
  no_existe: { status: 404, message: "Este enlace no existe." },
  ya_contestada: { status: 409, message: "Ya recibimos su opinión. Gracias." },
  vencida: { status: 410, message: "Este enlace ya venció." },
};

export async function POST(req: Request): Promise<Response> {
  const limited = await ipRateLimiter.check(req, RULES);
  if (limited) return limited;

  // «Solo lectura» (26-nov-2026): con su sesión puede abrir el enlace del cliente, pero no contestar por él.
  if (await sesionEsSoloLectura(req.headers)) {
    return Response.json({ ok: false, message: SOLO_LECTURA_MENSAJE }, { status: 403, headers: { [SOLO_LECTURA_HEADER]: "1" } });
  }

  // Se rechaza por el tamaño declarado antes de leer, y otra vez por lo que llegó.
  const demasiado = Response.json({ ok: false, message: "La respuesta es demasiado larga." }, { status: 413 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return demasiado;
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return demasiado;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, message: "No se pudo leer la respuesta." }, { status: 400 });
  }
  const parsed = respuestaSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Revise sus respuestas." },
      { status: 400 },
    );
  }

  try {
    const resultado = await responderOpinion(parsed.data);
    if (resultado === "ok") return Response.json({ ok: true });
    const { status, message } = RESPUESTAS[resultado];
    return Response.json({ ok: false, resultado, message }, { status });
  } catch (error) {
    logError("[opinion] no se pudo guardar la respuesta", error);
    return Response.json({ ok: false, message: "No se pudo guardar. Intente de nuevo." }, { status: 500 });
  }
}
