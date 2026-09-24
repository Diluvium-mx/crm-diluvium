"use client";

// Indicador "el Agente IA está trabajando en esta conversación" (Bandeja y pop-up
// del Embudo, dentro de ChatThread): píldora compacta que FLOTA al fondo del
// historial, arriba del cuadro de escribir, sin mover el layout, el scroll ni el
// composer. Así el vendedor no contesta encima (contestar pausa al agente).
//   leyendo     → orbe "breathing"  "Agente IA leyendo…"   (espera de 15 s)
//   escribiendo → orbe "composing"  "Agente IA escribiendo…"
//   enviando    → orbe "working"    "Agente IA enviando…"  (tabla, video, datos)
// Consultas: al abrir; con cada evento SSE de la conversación (refreshToken /
// detailKey) más reintentos a 1 s y 3 s (el worker crea el job un momento
// después del entrante); y cada 2 s SOLO mientras la píldora esté visible y la
// pestaña en primer plano. Ninguna consulta si no hay actividad.
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { getAgentActivity } from "@/lib/actions/agente-actividad";
import type { AgentActivity } from "@/lib/agente-ia/activity";

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

  // Consulta ahora y reintenta a 1 s y 3 s (respuestas viejas se descartan).
  useEffect(() => {
    let alive = true;
    const ask = async () => {
      const result = await getAgentActivity(conversationId);
      if (alive) setActivity(result);
    };
    void ask();
    const timers = RETRY_DELAYS_MS.map((ms) => setTimeout(() => void ask(), ms));
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [conversationId, refreshToken, detailKey]);

  // Mientras haya actividad y la pestaña esté visible: cada 2 s hasta que termine.
  useEffect(() => {
    if (!activity) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer || document.visibilityState !== "visible") return;
      timer = setInterval(() => {
        void getAgentActivity(conversationId).then((result) => {
          if (alive) setActivity(result);
        });
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
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
