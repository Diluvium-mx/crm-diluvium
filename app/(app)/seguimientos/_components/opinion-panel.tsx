"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { borrarEnlacePrueba, crearEnlacePrueba, guardarEnlaceGoogle } from "@/lib/actions/opiniones";
import type { OpinionVista, TonoEtiqueta } from "@/lib/opiniones/vista";

export type PermisosOpinion = { crear: boolean; editar: boolean; borrar: boolean };

// Seguimientos › Opinión (docs/opiniones.md): lo que contestan los clientes en el
// formulario público, el enlace de prueba para verlo como el cliente y el enlace de
// reseñas de Google que sale al final del formulario.
export function OpinionPanel({
  opiniones,
  googleUrl,
  puede,
}: {
  opiniones: OpinionVista[];
  googleUrl: string | null;
  puede: PermisosOpinion;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [enlace, setEnlace] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editandoGoogle, setEditandoGoogle] = useState(false);

  function crear() {
    setAviso(null);
    startTransition(async () => {
      const r = await crearEnlacePrueba();
      if (r.ok) {
        setEnlace(r.enlace);
        router.refresh();
      } else setAviso(r.message);
    });
  }

  function borrar(id: string) {
    setAviso(null);
    startTransition(async () => {
      const r = await borrarEnlacePrueba({ id });
      if (r.ok) router.refresh();
      else setAviso(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-foreground/70">
          Lo que contestan los clientes en el formulario después de su compra.
        </p>
        {puede.editar && (
          <Button variant="outline" size="sm" aria-expanded={editandoGoogle} onClick={() => setEditandoGoogle((v) => !v)}>
            Enlace de Google
          </Button>
        )}
        {puede.crear && (
          <Button
            size="sm"
            disabled={pendiente}
            onClick={crear}
            className="bg-brand-orange text-brand-white hover:bg-brand-orange-light"
          >
            Crear enlace de prueba
          </Button>
        )}
      </div>

      {editandoGoogle && (
        <EnlaceGoogle
          actual={googleUrl}
          onListo={() => {
            setEditandoGoogle(false);
            router.refresh();
          }}
          onCancelar={() => setEditandoGoogle(false)}
        />
      )}

      {enlace && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-navy/30 bg-brand-navy/5 px-3 py-2 text-sm">
          <span className="font-medium">Enlace de prueba listo:</span>
          <a href={enlace} target="_blank" rel="noopener noreferrer" data-link="text" className="min-w-0 break-all">
            {enlace}
          </a>
          <CopyButton getText={() => enlace} title="Copiar enlace" />
        </div>
      )}

      {aviso && (
        <p role="alert" className="text-sm text-destructive">
          {aviso}
        </p>
      )}

      {opiniones.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 px-4 py-8 text-center text-sm text-foreground/70 dark:border-white/15">
          Todavía no hay opiniones. Crea un enlace de prueba para ver el formulario como lo ve el cliente.
        </div>
      ) : (
        <ul className="divide-y divide-black/10 rounded-xl border border-black/10 bg-card dark:divide-white/10 dark:border-white/10">
          {opiniones.map((o) => (
            <Fila key={o.id} o={o} puedeBorrar={puede.borrar && o.prueba} ocupado={pendiente} onBorrar={() => borrar(o.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Fila({
  o,
  puedeBorrar,
  ocupado,
  onBorrar,
}: {
  o: OpinionVista;
  puedeBorrar: boolean;
  ocupado: boolean;
  onBorrar: () => void;
}) {
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <span className="truncate">{o.titulo}</span>
            {o.prueba && (
              <span
                title="Enlace de prueba: no es de un cliente"
                className="shrink-0 rounded-full border border-dashed border-amber-500/60 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300"
              >
                Prueba
              </span>
            )}
          </p>
          <p className="text-xs text-foreground/60">{o.fecha}</p>
        </div>
        {o.estrellas !== null && <Estrellas n={o.estrellas} />}
      </div>
      {o.texto && <p className="text-sm text-foreground/80">«{o.texto}»</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {o.etiquetas.map((e) => (
          <span key={e.texto} className={`rounded-md px-2 py-0.5 text-xs ${TONOS[e.tono]}`}>
            {e.texto}
          </span>
        ))}
        {o.enlace && (
          <>
            <CopyButton getText={() => o.enlace ?? ""} title="Copiar enlace" />
            <a
              href={o.enlace}
              target="_blank"
              rel="noopener noreferrer"
              data-link="text"
              className="inline-flex items-center gap-1 text-xs"
            >
              Abrir <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          </>
        )}
        {puedeBorrar && (
          <Button variant="ghost" size="xs" disabled={ocupado} onClick={onBorrar} className="ml-auto text-destructive">
            Borrar
          </Button>
        )}
      </div>
    </li>
  );
}

function Estrellas({ n }: { n: number }) {
  return (
    <span className="flex shrink-0 gap-0.5" role="img" aria-label={n === 1 ? "1 estrella" : `${n} estrellas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={`size-4 ${i <= n ? "fill-brand-orange text-brand-orange" : "text-foreground/20"}`}
        />
      ))}
    </span>
  );
}

function EnlaceGoogle({
  actual,
  onListo,
  onCancelar,
}: {
  actual: string | null;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [url, setUrl] = useState(actual ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await guardarEnlaceGoogle({ url });
      if (r.ok) onListo();
      else setError(r.message);
    });
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
      <label htmlFor="opinion-google" className="text-sm font-medium">
        Enlace de reseñas de Google
      </label>
      <Input
        id="opinion-google"
        value={url}
        placeholder="https://maps.app.goo.gl/…"
        onChange={(e) => {
          setUrl(e.target.value);
          setError(null);
        }}
      />
      <p className="text-xs text-foreground/60">
        Sale como botón «Dejar reseña en Google» al final del formulario. Si lo dejas vacío, no sale el botón.
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

const TONOS: Record<TonoEtiqueta, string> = {
  bien: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  alerta: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  marca: "bg-brand-navy/10 text-brand-navy dark:text-sky-300",
  neutro: "bg-black/5 text-foreground/70 dark:bg-white/10",
};
