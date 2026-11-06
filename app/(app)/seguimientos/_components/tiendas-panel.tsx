"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TopConfirm, TopNotice } from "@/components/ui/top-confirm";
import { deshacerEscribi, elegirTrato, quitarResena, yaLeEscribi } from "@/lib/actions/resenas-tienda";
import type { MensajesWhatsApp } from "@/lib/resenas-tienda/mensaje";
import type { Trato } from "@/lib/resenas-tienda/tiendas";
import type { ResenaVista, SeccionResena } from "@/lib/resenas-tienda/vista";
import { TONOS } from "./opinion-panel";

// Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § 8): los clientes que dijeron en el
// chat que compraron en una de esas tiendas (los anota el lector). Desde el 6-nov-2026 el CRM no
// manda nada: cada cliente trae sus mensajes listos (sin IA) para escribirle desde WhatsApp Web, sin
// costo, y aquí se marca «Ya le escribí».
const SECCIONES: ReadonlyArray<{ id: SeccionResena; titulo: string }> = [
  { id: "pedir", titulo: "Por solicitar" },
  { id: "espera", titulo: "En espera" },
  { id: "pedida", titulo: "Solicitadas" },
];

const NARANJA = "bg-brand-orange text-brand-white hover:bg-brand-orange-light";

const TRATOS: ReadonlyArray<{ valor: Trato | null; texto: string }> = [
  { valor: "sra", texto: "Sra." },
  { valor: "sr", texto: "Sr." },
  { valor: null, texto: "Solo su nombre" },
];

const RESPUESTAS: ReadonlyArray<{ clave: keyof MensajesWhatsApp; titulo: string }> = [
  { clave: "bien", titulo: "Si ya la instaló y le fue bien" },
  { clave: "problema", titulo: "Si tuvo algún problema" },
  { clave: "sinInstalar", titulo: "Si todavía no la instala" },
];

export function TiendasPanel({ resenas, puedeEditar }: { resenas: ResenaVista[]; puedeEditar: boolean }) {
  const router = useRouter();
  const [ocupado, startTransition] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [viendo, setViendo] = useState<string | null>(null);
  // Lo que pide confirmación con el aviso de arriba: quitarlo de la lista o «Ya le escribí».
  const [confirmando, setConfirmando] = useState<{ que: "quitar" | "escribi"; r: ResenaVista } | null>(null);

  function correr(accion: () => Promise<{ ok: true } | { ok: false; message: string }>, hecho: string | null, cerrar = true) {
    setAviso(null);
    setListo(null);
    startTransition(async () => {
      const r = await accion();
      if (r.ok) {
        if (cerrar) setViendo(null);
        setConfirmando(null);
        setListo(hecho);
        router.refresh();
      } else setAviso(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-foreground/70">
        Clientes que dijeron en el chat que compraron la compuerta en Amazon o Mercado Libre. Se les escribe desde WhatsApp Web
        con los mensajes listos: sin plantillas y sin costo.
      </p>

      {aviso && (
        <p role="alert" className="text-sm text-destructive">
          {aviso}
        </p>
      )}

      {resenas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 px-4 py-8 text-center text-sm text-foreground/70 dark:border-white/15">
          Todavía no hay clientes. Cuando alguien diga en el chat que ya compró en Amazon o Mercado Libre, aparece aquí.
        </div>
      ) : (
        SECCIONES.map(({ id, titulo }) => {
          const filas = resenas.filter((r) => r.seccion === id).sort((a, b) => a.orden - b.orden);
          if (filas.length === 0) return null;
          return (
            <section key={id} aria-labelledby={`resenas-${id}`} className="flex flex-col gap-2">
              <h3 id={`resenas-${id}`} className="flex items-center gap-2 text-sm font-medium">
                {titulo}
                <span className={`rounded-md px-1.5 text-xs font-normal ${id === "pedir" ? TONOS.alerta : TONOS.neutro}`}>
                  {filas.length}
                </span>
              </h3>
              <ul className="divide-y divide-black/10 rounded-xl border border-black/10 bg-card dark:divide-white/10 dark:border-white/10">
                {filas.map((r) => (
                  <Fila
                    key={r.id}
                    r={r}
                    puedeEditar={puedeEditar}
                    ocupado={ocupado}
                    viendo={viendo === r.id}
                    onVer={() => setViendo(viendo === r.id ? null : r.id)}
                    onTrato={(trato) => correr(() => elegirTrato({ id: r.id, trato }), null, false)}
                    onEscribi={() => setConfirmando({ que: "escribi", r })}
                    onDeshacer={() => correr(() => deshacerEscribi({ id: r.id }), `${r.titulo} regresó a «Por solicitar».`)}
                    onQuitar={() => setConfirmando({ que: "quitar", r })}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {confirmando?.que === "quitar" && (
        <TopConfirm
          title={`¿Quitar a ${confirmando.r.titulo} de la lista?`}
          confirmLabel="Quitar"
          pendingLabel="Quitando…"
          pending={ocupado}
          onConfirm={() => correr(() => quitarResena({ id: confirmando.r.id }), `${confirmando.r.titulo} salió de la lista.`)}
          onCancel={() => setConfirmando(null)}
        >
          No se le pedirá la reseña y el Agente IA ya no lo vuelve a anotar.
        </TopConfirm>
      )}
      {confirmando?.que === "escribi" && (
        <TopConfirm
          title={`¿Ya le escribiste a ${confirmando.r.titulo} por WhatsApp?`}
          confirmLabel="Sí, ya le escribí"
          pendingLabel="Guardando…"
          pending={ocupado}
          onConfirm={() => correr(() => yaLeEscribi({ id: confirmando.r.id }), `${confirmando.r.titulo} pasó a «Solicitadas».`)}
          onCancel={() => setConfirmando(null)}
        >
          Pasa a «Solicitadas», donde siguen sus mensajes para cuando conteste. El Agente IA se pausa en su chat para no
          contestarle él.
        </TopConfirm>
      )}
      <TopNotice message={confirmando ? null : listo} />
    </div>
  );
}

function Fila({
  r,
  puedeEditar,
  ocupado,
  viendo,
  onVer,
  onTrato,
  onEscribi,
  onDeshacer,
  onQuitar,
}: {
  r: ResenaVista;
  puedeEditar: boolean;
  ocupado: boolean;
  viendo: boolean;
  onVer: () => void;
  onTrato: (trato: Trato | null) => void;
  onEscribi: () => void;
  onDeshacer: () => void;
  onQuitar: () => void;
}) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 font-medium">
          <span className="truncate">{r.titulo}</span>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-normal ${TONOS.marca}`}>{r.tienda}</span>
        </p>
        <span className="flex shrink-0 items-center gap-1.5">
          {puedeEditar && r.marca === "escribi" && (
            <Button variant="outline" size="xs" disabled={ocupado} onClick={onEscribi}>
              Ya le escribí
            </Button>
          )}
          {puedeEditar && r.marca === "deshacer" && (
            <Button variant="outline" size="xs" disabled={ocupado} onClick={onDeshacer}>
              Deshacer
            </Button>
          )}
          {r.mensajes && (
            <Button
              size="xs"
              variant={r.seccion === "pedir" && !viendo ? "default" : "ghost"}
              disabled={ocupado}
              onClick={onVer}
              aria-expanded={viendo}
              className={r.seccion === "pedir" && !viendo ? NARANJA : undefined}
            >
              {viendo ? "Ocultar mensajes" : "Ver mensajes"}
            </Button>
          )}
        </span>
      </div>
      <p className="text-sm text-foreground/70">{r.aviso}</p>

      {viendo && r.mensajes && (
        <Mensajes r={r} mensajes={r.mensajes} puedeEditar={puedeEditar} ocupado={ocupado} onTrato={onTrato} />
      )}

      <div className="flex flex-wrap items-center gap-x-2 text-xs text-foreground/60">
        {r.frase && <span className="min-w-0">«{r.frase}»</span>}
        <span>{r.dicho}</span>
        <span className="ml-auto flex items-center gap-2">
          <Link href={r.chatHref} data-link="text">
            Ver chat
          </Link>
          {puedeEditar && (
            <Button variant="ghost" size="xs" disabled={ocupado} onClick={onQuitar}>
              Quitar
            </Button>
          )}
        </span>
      </div>
    </li>
  );
}

/** Los mensajes listos para copiar: primero los dos de entrada y después la respuesta que va. */
function Mensajes({
  r,
  mensajes,
  puedeEditar,
  ocupado,
  onTrato,
}: {
  r: ResenaVista;
  mensajes: MensajesWhatsApp;
  puedeEditar: boolean;
  ocupado: boolean;
  onTrato: (trato: Trato | null) => void;
}) {
  return (
    <div className="mt-1 flex flex-col gap-3 rounded-lg border border-brand-navy/30 bg-brand-navy/5 p-3 text-sm">
      {puedeEditar && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Cómo le hablas">
          <span className="text-xs text-foreground/70">Cómo le hablas:</span>
          {TRATOS.map(({ valor, texto }) => {
            const elegido = r.trato === valor;
            return (
              <Button
                key={texto}
                size="xs"
                variant={elegido ? "default" : "outline"}
                aria-pressed={elegido}
                disabled={ocupado || elegido}
                onClick={() => onTrato(valor)}
                className={elegido ? "bg-brand-navy text-brand-white disabled:opacity-100" : undefined}
              >
                {texto}
              </Button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-foreground/70">1. Para empezar (van los dos)</p>
          {r.whatsappHref && (
            <a
              href={r.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${NARANJA}`}
            >
              Abrir en WhatsApp Web <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
        <Burbuja texto={mensajes.saludo} titulo="Copiar el saludo" />
        <Burbuja texto={mensajes.pregunta} titulo="Copiar la pregunta" />
        {r.whatsappHref && (
          <p className="text-xs text-foreground/60">«Abrir en WhatsApp Web» abre su chat con el saludo ya escrito; después copia la pregunta.</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-foreground/70">2. Cuando conteste, la que vaya</p>
        {RESPUESTAS.map(({ clave, titulo }) => (
          <div key={clave} className="flex flex-col gap-1">
            <p className="text-xs text-foreground/60">{titulo}</p>
            <Burbuja texto={mensajes[clave]} titulo={`Copiar: ${titulo.toLowerCase()}`} />
          </div>
        ))}
      </div>

      <p className="text-xs text-foreground/60">
        Se le pide a todos por igual, les haya ido bien o mal, y sin ofrecer nada a cambio: así lo piden Amazon y Mercado Libre.
      </p>
    </div>
  );
}

function Burbuja({ texto, titulo }: { texto: string; titulo: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-card px-3 py-2 shadow-sm">
      <p className="min-w-0 flex-1 whitespace-pre-line">{texto}</p>
      <CopyButton getText={() => texto} title={titulo} />
    </div>
  );
}
