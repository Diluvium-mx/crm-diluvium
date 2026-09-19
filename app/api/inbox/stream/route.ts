// SSE de la bandeja: empuja al navegador un evento por cada cambio de mensaje
// o conversación de la organización activa (docs/bandeja.md). La UI, al
// recibirlo, vuelve a pedir esa fila/mensaje; el payload es mínimo a propósito.
//
// Aislamiento: solo se envían eventos de la organización de la sesión
// (subscribeToInbox filtra por org). Exige sesión; sin ella, 401.
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

      // Se suscribe PRIMERO y sólo después se manda `reload`: así ninguna
      // escritura que ocurra durante el handshake se pierde. Una escritura
      // anterior a la suscripción la cubre el `reload` (revalida todo); una
      // posterior ya llega como evento porque el suscriptor ya está registrado.
      try {
        unsubscribe = await subscribeToInbox(organizationId, sendEvent);
      } catch (error) {
        // Si LISTEN no se pudo establecer, se ERRORA el stream para que
        // EventSource lo detecte y reconecte, en vez de quedar abierto y mudo.
        console.error("[inbox stream] no se pudo suscribir:", error);
        try {
          controller.error(error);
        } catch {
          // el controller ya pudo cerrarse
        }
        cleanup();
        return;
      }
      // Si el cliente ya se fue mientras se suscribía, no dejar nada colgado.
      if (closed) {
        unsubscribe?.();
        return;
      }
      // Comentario inicial + `retry` + `reload`: abre el stream y le dice a la
      // UI que revalide todo (cubre lo escrito antes de completar la suscripción
      // y también una reconexión del cliente).
      send(`: conectado\nretry: 3000\nevent: reload\ndata: {}\n\n`);
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

  // El navegador cerró la pestaña / abortó: liberar la suscripción. cleanup es
  // idempotente (guarda `closed`), así que también corre desde cancel() del
  // stream sin efecto doble; el listener se va con el request al terminar.
  request.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // que el proxy no acumule el stream
    },
  });
}
