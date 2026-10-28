"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { TopConfirm, TopNotice } from "@/components/ui/top-confirm";
import { deshacerSolicitada, mandarPlantillaResena, pedirResena, quitarResena, yaLaSolicite } from "@/lib/actions/resenas-tienda";
import { cn } from "@/lib/utils";
import { SELLER_CENTRAL_PEDIDOS, type ResenaVista, type SeccionResena } from "@/lib/resenas-tienda/vista";
import { TONOS } from "./opinion-panel";

// Seguimientos › Amazon y Mercado Libre (27-oct-2026, docs/opiniones.md): los clientes que
// dijeron en el chat que compraron en una de esas tiendas (los anota el lector), en tres
// secciones según lo que se puede hacer hoy y con UNA acción cada uno. Amazon se pide en Seller
// Central y aquí se marca «Ya la solicité» (pregunta antes; en Solicitadas tiene «Deshacer»);
// Mercado Libre, con el texto fijo o la plantilla, cuando su tienda lo permite.
const SECCIONES: ReadonlyArray<{ id: SeccionResena; titulo: string }> = [
  { id: "pedir", titulo: "Por solicitar" },
  { id: "espera", titulo: "En espera" },
  { id: "pedida", titulo: "Solicitadas" },
];

const NARANJA = "bg-brand-orange text-brand-white hover:bg-brand-orange-light";

export function TiendasPanel({ resenas, puedeEditar }: { resenas: ResenaVista[]; puedeEditar: boolean }) {
  const router = useRouter();
  const [ocupado, startTransition] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [viendo, setViendo] = useState<string | null>(null);
  // Lo que pide confirmación con el aviso de arriba: quitarlo de la lista o marcar la de Amazon.
  const [confirmando, setConfirmando] = useState<{ que: "quitar" | "solicitada"; r: ResenaVista } | null>(null);

  function correr(accion: () => Promise<{ ok: true } | { ok: false; message: string }>, hecho: string) {
    setAviso(null);
    setListo(null);
    startTransition(async () => {
      const r = await accion();
      if (r.ok) {
        setViendo(null);
        setConfirmando(null);
        setListo(hecho);
        router.refresh();
      } else setAviso(r.message);
    });
  }

  function mandar(r: ResenaVista) {
    if (r.accion === "texto") correr(() => pedirResena({ id: r.id }), `Se le pidió la reseña a ${r.titulo}.`);
    else if (r.accion === "plantilla") correr(() => mandarPlantillaResena({ id: r.id }), `Se le mandó la plantilla a ${r.titulo}.`);
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-foreground/70">
        Clientes que dijeron en el chat que compraron la compuerta en Amazon o Mercado Libre.
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
                    onMandar={() => mandar(r)}
                    onQuitar={() => setConfirmando({ que: "quitar", r })}
                    onSolicitada={() => setConfirmando({ que: "solicitada", r })}
                    onDeshacer={() => correr(() => deshacerSolicitada({ id: r.id }), `${r.titulo} regresó a «Por solicitar».`)}
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
      {confirmando?.que === "solicitada" && (
        <TopConfirm
          title={`¿Ya tocaste «Sí» en Amazon para el pedido de ${confirmando.r.titulo}?`}
          confirmLabel="Sí, ya la solicité"
          pendingLabel="Guardando…"
          pending={ocupado}
          onConfirm={() => correr(() => yaLaSolicite({ id: confirmando.r.id }), `${confirmando.r.titulo} pasó a «Solicitadas».`)}
          onCancel={() => setConfirmando(null)}
        >
          Pasa a «Solicitadas». Amazon deja pedirla una sola vez por pedido.
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
  onMandar,
  onQuitar,
  onSolicitada,
  onDeshacer,
}: {
  r: ResenaVista;
  puedeEditar: boolean;
  ocupado: boolean;
  viendo: boolean;
  onVer: () => void;
  onMandar: () => void;
  onQuitar: () => void;
  onSolicitada: () => void;
  onDeshacer: () => void;
}) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 font-medium">
          <span className="truncate">{r.titulo}</span>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-normal ${TONOS.marca}`}>{r.tienda}</span>
        </p>
        {puedeEditar && (
          <span className="flex shrink-0 items-center gap-1.5">
            {r.marca === "solicitada" && (
              <Button variant="outline" size="xs" disabled={ocupado} onClick={onSolicitada}>
                Ya la solicité
              </Button>
            )}
            {r.marca === "deshacer" && (
              <Button variant="outline" size="xs" disabled={ocupado} onClick={onDeshacer}>
                Deshacer
              </Button>
            )}
            <Accion r={r} ocupado={ocupado} viendo={viendo} onVer={onVer} />
          </span>
        )}
      </div>
      <p className="text-sm text-foreground/70">{r.aviso}</p>

      {viendo && r.mensaje && (
        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-brand-navy/30 bg-brand-navy/5 p-3 text-sm">
          <p className="whitespace-pre-line">{r.mensaje}</p>
          <p className="text-xs text-foreground/60">
            {r.accion === "plantilla"
              ? "Plantilla «Reseña en tienda», con 3 botones: Me quedó bien · Tuve un problema · Aún no la instalo. Cuando conteste, sale «Pedir reseña»."
              : "Se le pide a todos por igual y sin ofrecer nada a cambio."}
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={ocupado} onClick={onMandar} className={NARANJA}>
              Mandar
            </Button>
            <Button variant="ghost" size="sm" disabled={ocupado} onClick={onVer}>
              Cancelar
            </Button>
          </div>
        </div>
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

/** La única acción del cliente, según su paso de hoy. */
function Accion({ r, ocupado, viendo, onVer }: { r: ResenaVista; ocupado: boolean; viendo: boolean; onVer: () => void }) {
  if (r.accion === "amazon") {
    return (
      <a
        href={SELLER_CENTRAL_PEDIDOS}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ size: "xs" }), "shrink-0", NARANJA)}
      >
        Pedir en Amazon <ExternalLink aria-hidden="true" />
      </a>
    );
  }
  if ((r.accion === "texto" || r.accion === "plantilla") && !viendo) {
    return (
      <Button size="xs" disabled={ocupado} onClick={onVer} className={`shrink-0 ${NARANJA}`}>
        {r.accion === "texto" ? "Pedir reseña" : "Mandar plantilla"}
      </Button>
    );
  }
  return null;
}
