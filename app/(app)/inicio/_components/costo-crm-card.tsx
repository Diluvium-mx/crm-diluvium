// «Costo del CRM» (20-nov-2026, opción A del dueño): hasta arriba del Dashboard, lo que va del mes, el cierre
// estimado y el mes pasado, con una barra de qué parte se lleva cada servicio. 21-nov-2026 (dueño): sin total
// acumulado; a la derecha el botón «Historial de costos» (cada mes, con el correo del día 3 en vivo).
// Sin lógica de datos: recibe el resumen ya calculado (lib/dashboard/costo-crm.ts).
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import type { CostoCrm, ServicioCosto } from "@/lib/dashboard/costo-crm";
import { formatUsd } from "@/lib/usd-format";
import { InfoNote } from "@/components/ui/info-note";

// Colores fijos por servicio (marca: navy y grises; el naranja es solo para alertas).
const COLOR: Record<ServicioCosto, string> = {
  meta: "bg-brand-navy-dark",
  ia: "bg-brand-navy/45",
  railway: "bg-zinc-500",
  zernio: "bg-zinc-300 dark:bg-zinc-600",
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CostoCrmCard({ costo }: { costo: CostoCrm }) {
  const c = costo;
  const detalle = [
    c.cierreUsd === null ? "El cierre se calcula después del primer día del mes" : `Cierre estimado ≈ ${formatUsd(c.cierreUsd)}`,
    c.prevUsd !== null && `${capital(c.prevLabel)}: ${formatUsd(c.prevUsd)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Costo del CRM · {c.monthLabel}</h2>
          <p className="mt-1 text-4xl font-semibold tabular-nums">
            {formatUsd(c.vaUsd)} <span className="text-sm font-normal text-muted-foreground">va</span>
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">{detalle}</p>
        </div>
        <Link
          href="/inicio/costos"
          data-link="card"
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border-[1.5px] border-brand-navy-dark bg-brand-navy-dark/5 px-3.5 py-2 text-sm font-medium text-foreground hover:bg-brand-navy-dark/10"
        >
          <CalendarDays className="size-5 text-brand-navy-dark" aria-hidden="true" />
          Historial de costos
        </Link>
      </div>
      {c.partes.length > 0 && (
        <>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Qué parte del costo del mes se lleva cada servicio">
            {c.partes.map((p) => (
              <div key={p.servicio} className={COLOR[p.servicio]} style={{ width: `${p.pct}%` }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {c.partes.map((p) => (
              <li key={p.servicio} className="flex items-center gap-1.5 tabular-nums">
                <span className={`inline-block size-2 rounded-full ${COLOR[p.servicio]}`} aria-hidden="true" />
                {p.label} {formatUsd(p.usd)} · {Math.round(p.pct)} %
              </li>
            ))}
          </ul>
        </>
      )}
      {c.sinDato.length > 0 && (
        <p className="mt-2 text-xs text-brand-orange">Sin dato de {c.sinDato.join(", ")} este mes: el monto va sin {c.sinDato.length === 1 ? "él" : "ellos"}.</p>
      )}
      <InfoNote>
        Suma lo que cuesta tener el CRM funcionando: IA, WhatsApp (lo que cobra Meta), Railway (los servidores) y Zernio (la
        mensajería), con las mismas cuentas del correo de costos del día 3. Fuera: suscripciones, publicidad y dominio. En
        dólares y sin impuestos. «Va» es lo que llevan este mes (Railway, lo de su periodo actual, nunca menos del plan); el
        cierre estimado sigue el ritmo de estos días. Cada mes, con el correo del día 3, está en Historial de costos.
      </InfoNote>
    </div>
  );
}
