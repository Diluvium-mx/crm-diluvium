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
import {
  isAccountAllowed,
  messagingProvider,
  MessagingNotConfiguredError,
  webhookEventRowId,
} from "@/lib/messaging";
import type { MessagingProvider, WebhookEnvelope } from "@/lib/messaging/provider";
import { enqueueInbound } from "@/lib/queue/inbound";

// Un mensaje con adjuntos llega como URL, no binario: 1 MB sobra.
const MAX_BODY_BYTES = 1_000_000;

// Lee el body cortando en cuanto pasa el límite: sin esto, un POST sin
// Content-Length (o chunked) obligaría a cargar en memoria un body de
// cualquier tamaño ANTES de validar la firma.
async function readBodyLimited(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(req: Request): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return new Response("payload demasiado grande", { status: 413 });

  const rawBody = await readBodyLimited(req, MAX_BODY_BYTES);
  if (rawBody === null) return new Response("payload demasiado grande", { status: 413 });

  let provider: MessagingProvider;
  try {
    provider = messagingProvider();
  } catch (error) {
    if (!(error instanceof MessagingNotConfiguredError)) throw error;
    // 503 (no 500): Zernio reintenta y el evento llega cuando se configure.
    console.error("[webhook zernio] canal no configurado:", error.message);
    return new Response("canal de WhatsApp no configurado", { status: 503 });
  }
  if (!provider.verifyWebhook(rawBody, req.headers)) {
    console.warn("[webhook zernio] firma inválida; se rechaza");
    return new Response("firma inválida", { status: 401 });
  }

  let payload: unknown;
  let envelope: WebhookEnvelope;
  try {
    payload = JSON.parse(rawBody);
    envelope = provider.readEnvelope(rawBody);
  } catch {
    // Firmado pero ilegible: reintentar no lo arreglaría.
    console.error("[webhook zernio] payload firmado pero inválido");
    return new Response("payload inválido", { status: 400 });
  }

  if (!isAccountAllowed(envelope.providerAccountId)) {
    // Cuenta ajena a este entorno (p. ej. el número real llegando a staging):
    // 200 para que Zernio no reintente, y NO se guarda nada.
    return Response.json({ ok: true, ignored: "cuenta no permitida en este entorno" });
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
