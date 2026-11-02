// Esqueletos de carga (auditoría de velocidad B3, 31-oct-2026): lo que se ve AL INSTANTE al tocar una pestaña
// del menú mientras el servidor arma la pantalla. Sin ningún `loading.tsx`, Next no precarga las pantallas
// dinámicas y el clic no mostraba nada hasta tener la página completa
// (node_modules/next/dist/docs/01-app/02-guides/prefetching.md › Prefetching static vs. dynamic routes).
// Solo formas grises con las mismas medidas que la pantalla real, para que nada brinque al llegar; el pulso se
// apaga con «Reducir movimiento». Cada sección elige el suyo en su `loading.tsx`.
import { cn } from "@/lib/utils";

function Barra({ className }: { className?: string }) {
  return <div className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)} />;
}

function Cargando({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-label="Cargando" className={className}>
      <span className="sr-only">Cargando…</span>
      {children}
    </div>
  );
}

const repetir = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Bandeja: el mismo alto fijo y la lista de 20rem de dashboard/page.tsx e inbox-board.tsx. */
export function EsqueletoBandeja() {
  return (
    <Cargando className="flex h-[calc(100dvh-4rem)] min-h-0 overflow-hidden">
      <div className="flex w-full shrink-0 flex-col gap-3 overflow-hidden border-r bg-card p-3 md:w-80">
        <Barra className="h-5 w-24" />
        <Barra className="h-9 w-full" />
        <Barra className="h-8 w-full" />
        {repetir(9).map((i) => (
          <div key={i} className="flex items-center gap-3 py-1">
            <Barra className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Barra className="h-3.5 w-2/3" />
              <Barra className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden flex-1 md:block" />
    </Cargando>
  );
}

/** Embudo: columnas de 18rem como contacts-board.tsx, con su barra azul de etapa y tarjetas. */
export function EsqueletoEmbudo() {
  return (
    <Cargando className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Barra className="h-6 w-24" />
        <Barra className="ml-auto h-9 w-full sm:w-72" />
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        {repetir(5).map((i) => (
          <div key={i} className="flex w-[calc(100vw-2.5rem)] shrink-0 flex-col rounded-lg border bg-muted sm:w-72">
            <div className="h-9 rounded-t-lg bg-brand-navy" />
            <div className="flex flex-col gap-2 p-2">
              {repetir(4).map((j) => (
                <Barra key={j} className="h-20 w-full bg-card" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Cargando>
  );
}

/** Dashboard (Inicio): título, tarjetas en tres columnas y la gráfica, como inicio/page.tsx. */
export function EsqueletoTarjetas() {
  return (
    <Cargando className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <Barra className="h-6 w-32" />
      <div className="grid gap-3 md:grid-cols-3">
        {repetir(6).map((i) => (
          <div key={i} className="flex h-32 flex-col gap-3 rounded-lg border bg-card p-4">
            <Barra className="h-4 w-1/2" />
            <Barra className="h-8 w-1/3" />
          </div>
        ))}
      </div>
      <Barra className="h-56 w-full" />
    </Cargando>
  );
}

/** Las demás secciones: título, pestañas y una lista. */
export function EsqueletoLista() {
  return (
    <Cargando className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <Barra className="h-6 w-40" />
      <div className="flex flex-wrap gap-2">
        {repetir(4).map((i) => (
          <Barra key={i} className="h-8 w-28" />
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
        {repetir(7).map((i) => (
          <Barra key={i} className="h-10 w-full" />
        ))}
      </div>
    </Cargando>
  );
}
