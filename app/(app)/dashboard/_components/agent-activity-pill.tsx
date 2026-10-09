"use client";

// Indicador "el Agente IA está trabajando en esta conversación" (Bandeja y pop-up
// del Embudo, dentro de ChatThread): píldora compacta que FLOTA al fondo del
// historial, arriba del cuadro de escribir, sin mover el layout, el scroll ni el
// composer. Así el vendedor no contesta encima (contestar pausa al agente).
//   leyendo     → orbe "breathing"  "Agente IA leyendo…"   (espera de 15 s)
//   escribiendo → orbe "composing"  "Agente IA escribiendo…"
//   enviando    → orbe "working"    "Agente IA enviando…"  (tabla, video, datos)
// Consultas: al abrir; con cada mensaje que llega o se va (refreshToken) o detalle
// nuevo (detailKey) más reintentos a 1 s y 3 s (el worker crea el job un momento
// después del entrante); y cada 2 s SOLO mientras la píldora esté visible y la
// pestaña en primer plano. Ninguna consulta si no hay actividad. Avisos seguidos se
// juntan (EVENT_BATCH_MS) y la consulta de cada 2 s espera a que conteste la anterior:
// las Server Actions de una pestaña van en fila y cada una de más retrasa los clics.
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { getAgentActivity } from "@/lib/actions/agente-actividad";
import type { AgentActivity } from "@/lib/agente-ia/activity";
import { EVENT_BATCH_MS } from "./chat-events";

const LABEL: Record<NonNullable<AgentActivity>, { state: OrbState; text: string }> = {
  leyendo: { state: "breathing", text: "Agente IA leyendo…" },
  escribiendo: { state: "composing", text: "Agente IA escribiendo…" },
  enviando: { state: "working", text: "Agente IA enviando…" },
};

const RETRY_DELAYS_MS = [1_000, 3_000];
const POLL_MS = 2_000;

export function AgentActivityPill({
  conversationId,
  refreshToken,
  detailKey,
}: {
  conversationId: string;
  /** Sube con cada evento SSE de esta conversación (mensajes). */
  refreshToken: number;
  /** Cambia cuando la Bandeja vuelve a pedir el detalle (conversation.updated). */
  detailKey?: unknown;
}) {
  const [activity, setActivity] = useState<AgentActivity>(null);
  const { resolvedTheme } = useTheme();
  // Al cambiar de conversación se limpia en el render (sin efecto); las
  // respuestas tardías de la anterior se descartan con la bandera `alive` de
  // cada efecto (su limpieza corre al cambiar de conversación).
  const [seen, setSeen] = useState(conversationId);
  if (seen !== conversationId) {
    setSeen(conversationId);
    setActivity(null);
  }

  // Consulta y reintenta a 1 s y 3 s (respuestas viejas se descartan). Al abrir la
  // conversación, de inmediato; con un aviso, tras EVENT_BATCH_MS (si llega otro antes,
  // se reinicia: varios avisos seguidos = una tanda). SOLO con la pestaña en primer
  // plano: una pestaña oculta con el SSE abierto no consulta nada; al volver a verse,
  // consulta de inmediato.
  const askedForRef = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    const ask = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await getAgentActivity(conversationId);
      if (alive) setActivity(result);
    };
    const delay = askedForRef.current === conversationId ? EVENT_BATCH_MS : 0;
    askedForRef.current = conversationId;
    const timers = [0, ...RETRY_DELAYS_MS].map((ms) => setTimeout(() => void ask(), delay + ms));
    const onVisible = () => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [conversationId, refreshToken, detailKey]);

  // Mientras haya actividad y la pestaña esté visible: 2 s DESPUÉS de que contestó la
  // consulta anterior, hasta que termine (con el servidor lento no se apilan en la fila).
  useEffect(() => {
    if (!activity) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    const start = () => {
      if (!alive || timer || inFlight || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        timer = undefined;
        inFlight = true;
        getAgentActivity(conversationId)
          .then((result) => {
            if (alive) setActivity(result);
          })
          .catch(() => undefined)
          .finally(() => {
            inFlight = false;
            start();
          });
      }, POLL_MS);
    };
    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activity, conversationId]);

  const dark = resolvedTheme === "dark";
  const shown = activity ? LABEL[activity] : null;
  return (
    // Envoltorio de alto CERO: la píldora se dibuja hacia arriba, sobre el fondo
    // del historial, sin ocupar espacio (el composer y el scroll no se mueven).
    <div className="pointer-events-none relative z-10 h-0">
      <div role="status" aria-live="polite" className="absolute bottom-2 left-1/2 -translate-x-1/2">
        {shown && (
          <span
            data-testid="agent-activity"
            className="flex items-center gap-2 rounded-full border border-brand-navy/20 bg-card/95 py-1 pr-3 pl-1.5 text-xs font-medium whitespace-nowrap text-brand-navy shadow-md backdrop-blur-sm dark:border-sky-300/30 dark:text-sky-200"
          >
            <span aria-hidden="true" className="flex size-5 items-center justify-center">
              <ThinkingOrb state={shown.state} size={20} theme={dark ? "dark" : "light"} color={dark ? "#9ec3f0" : "#0A559A"} />
            </span>
            {shown.text}
          </span>
        )}
      </div>
    </div>
  );
}
