"use client";

// Aviso emergente de "cambió de etapa" (decisión del dueño, 26-sep-2026): baja
// debajo de la barra de arriba, en TODAS las secciones del CRM (va en el layout),
// dura 10 s, se cierra solo o con la X. Solo cambios de etapa hechos por otro
// (Agente IA, automatización u otro vendedor); reglas y textos en ./stage-toasts.ts.
// Clic: abre el chat de ese contacto en la Bandeja; el grupo abre el Embudo.
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useInboxStream } from "../dashboard/_components/use-inbox-stream";
import { requestOpenContact } from "./open-contact";
import { groupText, nextExpiry, pushStageToast, stageToastFor, type StageToast } from "./stage-toasts";

export function StageChangeToasts({ viewerUserId }: { viewerUserId: string }) {
  const [toasts, setToasts] = useState<StageToast[]>([]);
  const seq = useRef(0);
  const router = useRouter();
  const pathname = usePathname();

  useInboxStream((event) => {
    if (event.type !== "contact.updated") return;
    const info = stageToastFor(event, viewerUserId);
    if (!info) return;
    const key = `aviso-${++seq.current}`;
    setToasts((current) => pushStageToast(current, info, Date.now(), key));
  });

  // Un solo reloj: al vencer el más próximo se quitan los vencidos.
  useEffect(() => {
    const next = nextExpiry(toasts);
    if (next === null) return;
    const timer = setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.expiresAt > Date.now())),
      Math.max(0, next - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [toasts]);

  function dismiss(key: string) {
    setToasts((current) => current.filter((toast) => toast.key !== key));
  }

  function open(toast: StageToast) {
    dismiss(toast.key);
    if (toast.kind === "group") {
      if (pathname !== "/embudo") router.push("/embudo");
      return;
    }
    if (pathname === "/dashboard") requestOpenContact(toast.contactId);
    else router.push(`/dashboard?contacto=${encodeURIComponent(toast.contactId)}`);
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
            className="pointer-events-auto flex w-full max-w-md overflow-hidden rounded-lg bg-brand-navy text-brand-white shadow-[0_10px_28px_-10px_rgb(4_30_60/0.7)] ring-1 ring-white/15 duration-300 ease-out animate-in fade-in-0 slide-in-from-top-4 motion-reduce:animate-none"
          >
            <span aria-hidden="true" className="w-1 shrink-0 bg-brand-orange" />
            <button
              type="button"
              onClick={() => open(toast)}
              title={toast.kind === "group" ? "Abrir el Embudo" : "Abrir su chat en la Bandeja"}
              className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm leading-snug"
            >
              <span className="line-clamp-2">{text}</span>
              <span className="sr-only">{toast.kind === "group" ? ". Abrir el Embudo" : ". Abrir su chat"}</span>
            </button>
            <button
              type="button"
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
