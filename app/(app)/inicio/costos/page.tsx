import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { cargarHistorialCostos } from "@/lib/costos/historial-cargar";
import { formatUsd } from "@/lib/usd-format";
import { AutoRefresh } from "./_components/auto-refresh";

// Dashboard › Historial de costos (21-nov-2026, pedido del dueño): el costo del CRM de cada mes, con el MISMO diseño y
// datos del correo de costos del día 3 (lib/costos/correo.ts). El mes en curso va en vivo (lo que va; se vuelve a pedir
// solo cada 5 min); los meses cerrados salen de lo guardado (crm_cost_months). Lo ve quien ve el Gasto de IA.
const hora = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", timeZone: "America/Mazatlan" });

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function mesSiguiente(clave: string): string {
  const [y, m] = clave.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 15));
  return new Intl.DateTimeFormat("es-MX", { month: "long", timeZone: "UTC" }).format(d);
}

export default async function HistorialCostosPage({ searchParams }: PageProps<"/inicio/costos">) {
  const { organizationId, role } = await requireActiveMembership({ acceso: "consulta" });
  if (!roleAllows(role, "aiSpend", "read")) notFound();
  const params = await searchParams;
  const now = new Date();
  const h = await cargarHistorialCostos(db, organizationId, param(params.mes), { now });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      {h.mes.enCurso && <AutoRefresh everyMs={5 * 60_000} />}
      <div className="flex flex-col gap-2">
        <Link
          href="/inicio"
          aria-label="Regresar a Dashboard"
          title="Regresar a Dashboard"
          className="flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span className="max-sm:hidden">Dashboard</span>
        </Link>
        <h1 className="text-lg font-semibold">Historial de costos</h1>
      </div>

      <nav aria-label="Mes" className="flex flex-wrap gap-2">
        {h.meses.map((m) => {
          const activo = m.clave === h.mes.clave;
          return (
            <Link
              key={m.clave}
              href={m.enCurso ? "/inicio/costos" : `/inicio/costos?mes=${m.clave}`}
              aria-current={activo ? "page" : undefined}
              data-link="tab"
              className={`rounded-full border px-3 py-1 text-sm ${activo ? "border-brand-navy-dark font-medium text-foreground ring-1 ring-brand-navy-dark" : "text-muted-foreground"}`}
            >
              {m.nombre}
              {m.enCurso ? " · en curso" : ""}
            </Link>
          );
        })}
      </nav>

      {h.mes.enCurso && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span className="inline-block size-2 rounded-full bg-emerald-600" aria-hidden="true" />
          En vivo: lo que va del mes, al {hora.format(now)} (se actualiza solo cada 5 min).
          {h.cierreUsd !== null && <span className="text-foreground">Cierre estimado ≈ {formatUsd(h.cierreUsd)}.</span>}
        </p>
      )}

      {/* El correo tal como llega: estilos en línea pensados para fondo blanco, por eso va en una hoja blanca. */}
      <div data-correo className="rounded-lg border bg-white p-4 text-[#111827] shadow-sm" dangerouslySetInnerHTML={{ __html: h.html }} />

      <p className="text-center text-xs text-muted-foreground">
        {h.mes.enCurso
          ? `El correo de ${h.mes.nombre.replace(/ de \d{4}$/, "").toLowerCase()} sale solo el día 3 de ${mesSiguiente(h.mes.clave)} a las 9:00, con las cifras de cierre.`
          : "Mes cerrado: estas son sus cifras finales."}
      </p>
    </div>
  );
}
