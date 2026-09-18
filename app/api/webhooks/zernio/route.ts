// Webhook de Zernio (WhatsApp). CLAUDE.md §4: solo valida firma, guarda,
// encola y responde 200 rápido; todo el procesamiento es del worker.
//
// Orden deliberado:
// 1. firma sobre el body CRUDO (re-serializar el JSON rompería el HMAC);
// 2. INSERT idempotente del evento crudo (PK = proveedor + id del evento):
//    un reintento de Zernio choca con la PK y no se procesa dos veces;
// 3. encolar (si falla, el barrido del worker lo recoge desde la base);
// 4. 200. Solo se responde error si NO se pudo guardar: así Zernio reintenta
//    en vez de dar el evento por entregado y perderlo.
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import { messagingProvider, webhookEventRowId } from "@/lib/messaging";
import { enqueueInbound } from "@/lib/queue/inbound";

// Un mensaje con adjuntos llega como URL, no binario: 1 MB sobra.
const MAX_BODY_BYTES = 1_000_000;

export async function POST(req: Request): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return new Response("payload demasiado grande", { status: 413 });

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return new Response("payload demasiado grande", { status: 413 });
  }

  const provider = messagingProvider();
  if (!provider.verifyWebhook(rawBody, req.headers)) {
    console.warn("[webhook zernio] firma inválida; se rechaza");
    return new Response("firma inválida", { status: 401 });
  }

  let payload: unknown;
  let envelope: { eventId: string; event: string };
  try {
    payload = JSON.parse(rawBody);
    envelope = provider.readEnvelope(rawBody);
  } catch {
    // Firmado pero ilegible: reintentar no lo arreglaría.
    console.error("[webhook zernio] payload firmado pero inválido");
    return new Response("payload inválido", { status: 400 });
  }

  const rowId = webhookEventRowId(provider.name, envelope.eventId);
  const inserted = await db
    .insert(webhookEvents)
    .values({ id: rowId, provider: provider.name, event: envelope.event, payload })
    .onConflictDoNothing({ target: webhookEvents.id })
    .returning({ id: webhookEvents.id });

  if (inserted.length > 0) await enqueueInbound(rowId);

  return Response.json({ ok: true, duplicate: inserted.length === 0 });
}
