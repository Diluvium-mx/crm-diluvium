"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guardarEnlacesResena, marcarResena, pedirResena, yaLaPediEnAmazon } from "@/lib/actions/resenas-tienda";
import type { EnlacesTiendas } from "@/lib/resenas-tienda/queries";
import type { ResenaVista } from "@/lib/resenas-tienda/vista";
import { TONOS } from "./opinion-panel";

// Seguimientos › Amazon y Mercado Libre (27-oct-2026, docs/opiniones.md): los clientes que
// dijeron en el chat que compraron en una de esas tiendas (los anota el lector). A los de Mercado
// Libre se les pide la reseña con un texto fijo, sin IA; los de Amazon se piden en Seller Central
// (Amazon no deja escribirles por fuera) y aquí solo se anotan.
export function TiendasPanel({
  resenas,
  enlaces,
  puedeEditar,
}: {
  resenas: ResenaVista[];
  enlaces: EnlacesTiendas;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [ocupado, startTransition] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  const [viendo, setViendo] = useState<string | null>(null);
  const [editandoEnlaces, setEditandoEnlaces] = useState(false);

  function correr(accion: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setAviso(null);
    startTransition(async () => {
      const r = await accion();
      if (r.ok) {
        setViendo(null);
        router.refresh();
      } else setAviso(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-foreground/70">
          Clientes que dijeron en el chat que compraron la compuerta en Amazon o Mercado Libre.
        </p>
        {puedeEditar && (
          <Button variant="outline" size="sm" aria-expanded={editandoEnlaces} onClick={() => setEditandoEnlaces((v) => !v)}>
            Enlace de Mercado Libre
          </Button>
        )}
      </div>

      {editandoEnlaces && (
        <EnlacesForm
          actuales={enlaces}
          onListo={() => {
            setEditandoEnlaces(false);
            router.refresh();
          }}
          onCancelar={() => setEditandoEnlaces(false)}
        />
      )}

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
        <ul className="divide-y divide-black/10 rounded-xl border border-black/10 bg-card dark:divide-white/10 dark:border-white/10">
          {resenas.map((r) => (
            <Fila
              key={r.id}
              r={r}
              puedeEditar={puedeEditar}
              ocupado={ocupado}
              viendo={viendo === r.id}
              onVer={() => setViendo(viendo === r.id ? null : r.id)}
              onPedir={() => correr(() => pedirResena({ id: r.id }))}
              onPedidaEnAmazon={() => correr(() => yaLaPediEnAmazon({ id: r.id }))}
              onMarcar={(estado) => correr(() => marcarResena({ id: r.id, estado }))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Fila({
  r,
  puedeEditar,
  ocupado,
  viendo,
  onVer,
  onPedir,
  onPedidaEnAmazon,
  onMarcar,
}: {
  r: ResenaVista;
  puedeEditar: boolean;
  ocupado: boolean;
  viendo: boolean;
  onVer: () => void;
  onPedir: () => void;
  onPedidaEnAmazon: () => void;
  onMarcar: (estado: "la_dejo" | "no_quiso" | "descartada") => void;
}) {
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <span className="truncate">{r.titulo}</span>
            <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-normal ${TONOS.marca}`}>{r.tienda}</span>
          </p>
          <p className="text-xs text-foreground/60">{r.fecha}</p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${TONOS[r.tono]}`}>{r.estadoTexto}</span>
      </div>
      {r.frase && <p className="text-sm text-foreground/80">«{r.frase}»</p>}

      {viendo && (
        <div className="flex flex-col gap-2 rounded-lg border border-brand-navy/30 bg-brand-navy/5 p-3 text-sm">
          <p className="whitespace-pre-line">{r.mensaje}</p>
          <p className="text-xs text-foreground/60">Se le pide a todos por igual y sin ofrecer nada a cambio.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={ocupado}
              onClick={onPedir}
              className="bg-brand-orange text-brand-white hover:bg-brand-orange-light"
            >
              Mandar
            </Button>
            <Button variant="ghost" size="sm" disabled={ocupado} onClick={onVer}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={r.chatHref} data-link="text" className="text-xs">
          Ver chat
        </Link>
        {puedeEditar && r.estado === "por_pedir" && (
          <>
            {r.enAmazon ? (
              <>
                <span className="text-xs text-foreground/60">· {r.bloqueo}</span>
                <Button variant="outline" size="xs" disabled={ocupado} onClick={onPedidaEnAmazon}>
                  Ya la pedí en Amazon
                </Button>
              </>
            ) : r.bloqueo ? (
              <span className="text-xs text-foreground/60">· {r.bloqueo}</span>
            ) : (
              !viendo && (
                <Button
                  size="xs"
                  disabled={ocupado}
                  onClick={onVer}
                  className="bg-brand-orange text-brand-white hover:bg-brand-orange-light"
                >
                  Pedir reseña
                </Button>
              )
            )}
            <Button variant="ghost" size="xs" disabled={ocupado} onClick={() => onMarcar("descartada")} className="ml-auto">
              No compró ahí
            </Button>
          </>
        )}
        {puedeEditar && r.estado === "pedida" && (
          <span className="ml-auto flex gap-1.5">
            <Button variant="outline" size="xs" disabled={ocupado} onClick={() => onMarcar("la_dejo")}>
              La dejó
            </Button>
            <Button variant="ghost" size="xs" disabled={ocupado} onClick={() => onMarcar("no_quiso")}>
              No quiso
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

function EnlacesForm({
  actuales,
  onListo,
  onCancelar,
}: {
  actuales: EnlacesTiendas;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [mercadoLibre, setMercadoLibre] = useState(actuales.mercado_libre ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // El de Amazon ya no va en ningún mensaje (se pide en Seller Central): se guarda como estaba.
      const r = await guardarEnlacesResena({ amazon: actuales.amazon ?? "", mercadoLibre });
      if (r.ok) onListo();
      else setError(r.message);
    });
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
      <label htmlFor="resena-mercado-libre" className="text-sm font-medium">
        Enlace de reseña de Mercado Libre
      </label>
      <Input
        id="resena-mercado-libre"
        value={mercadoLibre}
        placeholder="https://…"
        onChange={(e) => {
          setMercadoLibre(e.target.value);
          setError(null);
        }}
      />
      <p className="text-xs text-foreground/60">
        Va en el mensaje que pide la reseña. Si lo dejas vacío, el mensaje explica dónde se deja dentro de Mercado Libre.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={guardando}>
          Guardar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
