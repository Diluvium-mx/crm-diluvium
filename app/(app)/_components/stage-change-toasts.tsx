"use client";

// Aviso emergente de "cambió de etapa" (decisión del dueño, 26-sep-2026): baja
// debajo de la barra de arriba, en TODAS las secciones del CRM (va en el layout),
// dura 10 s, se cierra solo o con la X. Solo cambios de etapa (Agente IA, automatización
// o una persona, también quien lo hizo); reglas y textos en ./stage-toasts.ts.
// Clic: abre el chat de ese contacto en la Bandeja; el grupo abre el Embudo.
//
// Versión móvil (< md, decisión del dueño, 29-sep-2026): tarjetas delgadas, centradas
// y arriba (no tapan el chat), texto completo con 🤖/🌎/👨🏽‍💻/⚙️, 4 s con una barra naranja
// abajo que se vacía, halo oscuro difuminado SOLO alrededor de cada tarjeta (el resto de
// la pantalla no se oscurece) y la ✕ blanca de siempre. El agrupado (desde el 4.º) se
// despliega con cada cambio y no vence mientras está abierto. Escritorio: igual que antes.
//
// Luz del cursor (8-oct-2026): la tarjeta se ilumina COMPLETA, como una sola pieza, esté
// el cursor sobre el texto o sobre la ✕ (data-glow en la tarjeta y data-no-glow en sus dos
// botones, como la fila de la Bandeja). En el celular solo la fila de arriba: los cambios
// del agrupado desplegado conservan su propia luz.
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useInboxStream } from "../dashboard/_components/use-inbox-stream";
import { requestOpenContact } from "./open-contact";
import { useFunnelStages } from "./funnel-stages-provider";
import { useIsMobile } from "@/components/ui/use-media-query";
import {
  groupText,
  MOBILE_TOAST_MS,
  nextExpiry,
  pruneExpired,
  pushStageToast,
  renewToast,
  stageToastFor,
  TOAST_MS,
  type StageToast,
} from "./stage-toasts";

export function StageChangeToasts({ viewerUserId }: { viewerUserId: string }) {
  const [toasts, setToasts] = useState<StageToast[]>([]);
  // Celular: el agrupado desplegado (no vence mientras siga abierto).
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const seq = useRef(0);
  const router = useRouter();
  const pathname = usePathname();
  const { labelOf } = useFunnelStages();
  const isMobile = useIsMobile();
  const duration = isMobile ? MOBILE_TOAST_MS : TOAST_MS;

  // Refs para el handler del SSE (se suscribe una sola vez).
  const durationRef = useRef(duration);
  const heldRef = useRef<string | null>(null);
  useEffect(() => {
    durationRef.current = duration;
    heldRef.current = openGroupKey;
  });

  useInboxStream((event) => {
    if (event.type !== "contact.updated") return;
    const info = stageToastFor(event, viewerUserId, labelOf);
    if (!info) return;
    const key = `aviso-${++seq.current}`;
    setToasts((current) => pushStageToast(current, info, Date.now(), key, durationRef.current, heldRef.current));
  });

  // Un solo reloj: al vencer el más próximo se quitan los vencidos (el agrupado abierto no).
  useEffect(() => {
    const next = nextExpiry(toasts, openGroupKey);
    if (next === null) return;
    const timer = setTimeout(
      () => setToasts((current) => pruneExpired(current, Date.now(), openGroupKey)),
      Math.max(0, next - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [toasts, openGroupKey]);

  function dismiss(key: string) {
    setToasts((current) => current.filter((toast) => toast.key !== key));
    if (openGroupKey === key) setOpenGroupKey(null);
  }

  function openContact(contactId: string) {
    if (pathname === "/dashboard") requestOpenContact(contactId);
    else router.push(`/dashboard?contacto=${encodeURIComponent(contactId)}`);
  }

  function openFunnel() {
    if (pathname !== "/embudo") router.push("/embudo");
  }

  function open(toast: StageToast) {
    dismiss(toast.key);
    if (toast.kind === "group") openFunnel();
    else openContact(toast.contactId);
  }

  // Celular: desplegar / plegar el agrupado. Al plegarlo su tiempo vuelve a empezar.
  function toggleGroup(key: string) {
    if (openGroupKey === key) {
      setOpenGroupKey(null);
      setToasts((current) => renewToast(current, key, Date.now(), MOBILE_TOAST_MS));
    } else {
      setOpenGroupKey(key);
    }
  }

  if (isMobile) {
    return (
      // Arriba (debajo de la barra de 4rem), centradas y delgadas: no llegan al centro de
      // la pantalla ni tapan el chat. Sin fondo oscurecido: el halo va en cada tarjeta.
      <div
        aria-live="polite"
        aria-label="Avisos de cambio de etapa"
        className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-[60] flex flex-col items-center gap-2 px-6"
      >
        {toasts.map((toast) => {
          const expanded = toast.kind === "group" && openGroupKey === toast.key;
          return (
            <div
              key={toast.key}
              className="pointer-events-auto w-full max-w-md overflow-hidden rounded-lg bg-brand-navy text-brand-white shadow-[0_6px_30px_6px_rgb(0_0_0/0.35)] duration-200 ease-out animate-in fade-in-0 slide-in-from-top-2 motion-reduce:animate-none"
            >
              <div data-glow="" className="flex items-start">
                <button
                  type="button"
                  data-no-glow=""
                  onClick={() => (toast.kind === "group" ? toggleGroup(toast.key) : open(toast))}
                  aria-expanded={toast.kind === "group" ? expanded : undefined}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left text-[13px] leading-snug"
                >
                  <span className="min-w-0 break-words">
                    {toast.kind === "group" ? groupText(toast.contactIds.length) : toast.mobileText}
                  </span>
                  {toast.kind === "group" &&
                    (expanded ? (
                      <ChevronUp className="size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                    ))}
                </button>
                <button
                  type="button"
                  data-no-glow=""
                  onClick={() => dismiss(toast.key)}
                  aria-label="Cerrar aviso"
                  title="Cerrar"
                  className="shrink-0 self-stretch px-3 text-brand-white/80 hover:text-brand-white"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>

              {expanded && toast.kind === "group" && (
                <ul className="max-h-40 overflow-y-auto overscroll-contain border-t border-white/20">
                  {toast.items.map((item) => (
                    <li key={item.contactId} className="border-b border-white/10">
                      <button
                        type="button"
                        onClick={() => {
                          dismiss(toast.key);
                          openContact(item.contactId);
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs leading-snug break-words"
                      >
                        {item.mobileText}
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        dismiss(toast.key);
                        openFunnel();
                      }}
                      className="w-full px-3 py-1.5 text-left text-[11px] text-brand-white/80"
                    >
                      Ver todo en el Embudo
                    </button>
                  </li>
                </ul>
              )}

              {/* Barra de tiempo: se vacía en lo que le queda al aviso. `key` con el
                  vencimiento: si el aviso se renueva, la barra vuelve a empezar. Quieta
                  mientras el agrupado está abierto (no vence). */}
              <div aria-hidden="true" className="h-[3px] bg-white/15">
                {!expanded && <ToastDrain key={toast.expiresAt} expiresAt={toast.expiresAt} />}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    // Fijo debajo de la barra de arriba (4rem) y a la derecha del sidebar (w-56):
    // no tapa la barra ni el menú. Encima de los pop-ups (z-50) para verse siempre.
    <div
      aria-live="polite"
      aria-label="Avisos de cambio de etapa"
      className="pointer-events-none fixed top-[4.75rem] right-0 left-56 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => {
        const text = toast.kind === "group" ? groupText(toast.contactIds.length) : toast.text;
        return (
          <div
            key={toast.key}
            data-glow=""
            className="pointer-events-auto flex w-full max-w-md overflow-hidden rounded-lg bg-brand-navy text-brand-white shadow-[0_10px_28px_-10px_rgb(4_30_60/0.7)] ring-1 ring-white/15 duration-300 ease-out animate-in fade-in-0 slide-in-from-top-4 motion-reduce:animate-none"
          >
            <span aria-hidden="true" className="w-1 shrink-0 bg-brand-orange" />
            <button
              type="button"
              data-no-glow=""
              onClick={() => open(toast)}
              title={toast.kind === "group" ? "Abrir el Embudo" : "Abrir su chat en la Bandeja"}
              className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm leading-snug"
            >
              <span className="line-clamp-2">{text}</span>
              <span className="sr-only">{toast.kind === "group" ? ". Abrir el Embudo" : ". Abrir su chat"}</span>
            </button>
            <button
              type="button"
              data-no-glow=""
              onClick={() => dismiss(toast.key)}
              aria-label="Cerrar aviso"
              title="Cerrar"
              className="shrink-0 px-2.5 text-brand-white/80 hover:text-brand-white"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// La barra naranja que se vacía en lo que le queda al aviso (lo calcula al montarse:
// un aviso renovado cambia su `key` y la barra vuelve a empezar llena).
function ToastDrain({ expiresAt }: { expiresAt: number }) {
  const [ms] = useState(() => Math.max(0, expiresAt - Date.now()));
  return (
    <div
      className="h-full bg-brand-orange-light motion-reduce:hidden"
      style={{ animation: `toast-drain ${ms}ms linear forwards` }}
    />
  );
}
