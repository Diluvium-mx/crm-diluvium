"use client";

// Indicador "el Agente IA trabaja en segundo plano" (29-sep-2026, pedido del dueño): una
// línea bajo "Calificación" en el Detalle del contacto (Bandeja y pop-up del Embudo, mismo
// componente). Deja ver que el Detalle lo llena el Agente IA aunque esté apagado o pausado:
//   ⏳ Leerá el chat en ~2 min      → hay mensajes sin leer (espera a que el chat se calme)
//   (orbe) Agente IA leyendo el chat… → Luna lo está leyendo ahora
//   (orbe) Actualizó 3 datos          → terminó y cambió algo (los campos brillan, IaMark)
//   ✓ Al día · leído 10:42            → sin nada nuevo desde su última lectura
//   No pudo leer el chat · …          → la última lectura falló; el barrido reintenta solo
// Consultas: una al abrir; luego solo por eventos del tiempo real (lector.status para este
// contacto, mensajes de sus chats, reconexión) y al volver a la pestaña. Sin sondeo
// periódico. Si un aviso se pierde, "leyendo" se apaga solo a los 90 s y la espera vuelve
// a consultar cuando ya debió leerse. Si algo falla, no se muestra nada.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { getLectorStatus } from "@/lib/actions/agente-lector";
import type { LectorStatusView } from "@/lib/agente-ia/lector-status-store";
import { useInboxStream } from "../../dashboard/_components/use-inbox-stream";

const READING_MAX_MS = 90_000;
const UPDATED_SHOW_MS = 6_000;
const MESSAGE_REFETCH_MS = 1_500;
const TICK_MS = 15_000;

type Live = { kind: "leyendo" } | { kind: "actualizo"; cambios: number } | null;

const TIME = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mazatlan", hour: "2-digit", minute: "2-digit", hour12: false });
const DAY = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mazatlan", day: "numeric", month: "short" });

// "10:42" si fue hoy (hora de Mazatlán); si no, "28 sept 10:42".
function readAt(iso: string, now: number): string {
  const d = new Date(iso);
  const today = DAY.format(now) === DAY.format(d);
  return today ? TIME.format(d) : `${DAY.format(d).replace(/\./g, "")} ${TIME.format(d)}`;
}

function etaLabel(seconds: number): string {
  return seconds < 60 ? "en un momento" : `en ~${Math.ceil(seconds / 60)} min`;
}

const HELP = "El Agente IA lee el chat en segundo plano (aunque esté apagado o pausado) y llena el Detalle. Nunca le escribe al cliente.";

export function LectorStatusLine({ contactId }: { contactId: string }) {
  const { resolvedTheme } = useTheme();
  const [view, setView] = useState<{ data: LectorStatusView; at: number } | null>(null);
  const [live, setLive] = useState<Live>(null);
  // Reloj del indicador (cuenta de la espera y "hoy"): se mueve con la consulta y cada 15 s.
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);
  const conversationIds = useRef<readonly string[]>([]);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Al cambiar de contacto se limpia en el render (sin efecto).
  const [seen, setSeen] = useState(contactId);
  if (seen !== contactId) {
    setSeen(contactId);
    setView(null);
    setLive(null);
  }

  // Solo aplica la respuesta del último pedido (y nunca la de otro contacto).
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const data = await getLectorStatus(contactId);
    if (mine !== seq.current) return;
    conversationIds.current = data?.conversationIds ?? [];
    const at = Date.now();
    setNow(at);
    setView(data ? { data, at } : null);
  }, [contactId]);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(refetchTimer.current);
    };
  }, [load]);

  useInboxStream((event) => {
    if (event.type === "reload") {
      void load();
      return;
    }
    if (event.type === "lector.status") {
      if (event.contactId !== contactId) return;
      if (event.phase === "leyendo") setLive({ kind: "leyendo" });
      else {
        setLive(event.phase === "listo" && event.cambios > 0 ? { kind: "actualizo", cambios: event.cambios } : null);
        void load();
      }
      return;
    }
    // Un mensaje nuevo en sus chats: puede quedar "en espera" (juntos, una sola consulta).
    if ((event.type === "message.upserted" || event.type === "conversation.updated") && conversationIds.current.includes(event.conversationId)) {
      clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => void load(), MESSAGE_REFETCH_MS);
    }
  });

  // "Leyendo" que nunca terminó (aviso perdido, proceso reiniciado): se apaga solo.
  useEffect(() => {
    if (live?.kind !== "leyendo") return;
    const t = setTimeout(() => {
      setLive(null);
      void load();
    }, READING_MAX_MS);
    return () => clearTimeout(t);
  }, [live, load]);

  // "Actualizó N datos" se ve unos segundos.
  useEffect(() => {
    if (live?.kind !== "actualizo") return;
    const t = setTimeout(() => setLive(null), UPDATED_SHOW_MS);
    return () => clearTimeout(t);
  }, [live]);

  // En espera: la cuenta baja sola; si ya debió leerse y no llegó aviso, se vuelve a consultar.
  const status = view?.data.status ?? null;
  useEffect(() => {
    if (status?.kind !== "espera" || !view) return;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    const late = setTimeout(() => void load(), (status.etaSeconds + 90) * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(late);
    };
  }, [status, view, load]);

  const dark = resolvedTheme === "dark";
  const orb = (state: OrbState) => (
    <span aria-hidden="true" className="flex size-4 items-center justify-center">
      <span className="scale-[0.8]">
        <ThinkingOrb state={state} size={20} theme={dark ? "dark" : "light"} color={dark ? "#9ec3f0" : "#0A559A"} />
      </span>
    </span>
  );
  const active = "bg-brand-navy/10 text-brand-navy dark:bg-brand-white/15 dark:text-brand-white";
  const quiet = "bg-muted text-muted-foreground";

  let content: { cls: string; icon: React.ReactNode; text: string } | null = null;
  if (live?.kind === "leyendo" || (!live && status?.kind === "leyendo")) {
    content = { cls: active, icon: orb("breathing"), text: "Agente IA leyendo el chat…" };
  } else if (live?.kind === "actualizo") {
    content = { cls: active, icon: orb("working"), text: `Agente IA actualizó ${live.cambios} ${live.cambios === 1 ? "dato" : "datos"}` };
  } else if (status?.kind === "espera" && view) {
    const left = Math.max(0, status.etaSeconds - Math.round((now - view.at) / 1000));
    content = { cls: quiet, icon: <span aria-hidden="true">⏳</span>, text: `Agente IA leerá el chat ${etaLabel(left)}` };
  } else if (status?.kind === "al_dia") {
    content = { cls: quiet, icon: <span aria-hidden="true">✓</span>, text: `Al día · leído ${readAt(status.at, now)}` };
  } else if (status?.kind === "error") {
    content = { cls: "bg-brand-orange/10 text-brand-orange", icon: <span aria-hidden="true">!</span>, text: "No pudo leer el chat · se reintenta solo" };
  }

  if (!content) return null;
  return (
    <div role="status" aria-live="polite">
      <span
        data-testid="lector-status"
        title={HELP}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${content.cls}`}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{content.icon}</span>
        <span className="truncate">{content.text}</span>
      </span>
    </div>
  );
}
