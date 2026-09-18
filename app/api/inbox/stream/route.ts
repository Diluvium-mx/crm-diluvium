// SSE de la bandeja: empuja al navegador un evento por cada cambio de mensaje
// o conversación de la organización activa (docs/bandeja.md). La UI, al
// recibirlo, vuelve a pedir esa fila/mensaje; el payload es mínimo a propósito.
//
// Aislamiento: solo se envían eventos de la organización de la sesión
// (subscribeToInbox filtra por org). Exige sesión; sin ella, 401.
import { after } from "next/server";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { subscribeToInbox } from "@/lib/inbox/events";
import type { InboxEvent } from "@/lib/inbox/types";

// LISTEN vive mientras la conexión está abierta: este handler no puede ser
// estático ni cachearse.
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request): Promise<Response> {
  let membership;
  try {
    membership = await requireActiveMembership();
  } catch {
    return new Response("no autenticado", { status: 401 });
  }
  const { organizationId } = membership;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const sendEvent = (event: InboxEvent) => send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

      // Comentario inicial: abre el stream y, tras una reconexión del cliente,
      // le dice que revalide todo (pudo perder eventos mientras estuvo caído).
      send(`: conectado\nretry: 3000\nevent: reload\ndata: {}\n\n`);

      try {
        unsubscribe = await subscribeToInbox(organizationId, sendEvent);
      } catch (error) {
        console.error("[inbox stream] no se pudo suscribir:", error);
        cleanup();
        return;
      }
      // Si el cliente ya se fue mientras se suscribía, no dejar nada colgado.
      if (closed) {
        unsubscribe?.();
        return;
      }
      heartbeat = setInterval(() => send(`: keep-alive\n\n`), HEARTBEAT_MS);
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
  }

  // El navegador cerró la pestaña / abortó: liberar la suscripción.
  request.signal.addEventListener("abort", cleanup);
  after(() => {
    request.signal.removeEventListener("abort", cleanup);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // que el proxy no acumule el stream
    },
  });
}
