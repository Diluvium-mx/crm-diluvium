// «Celular y WhatsApp Web» (11-nov-2026, pedido del dueño): cuánto se ahorró en el periodo porque un vendedor contestó
// desde el celular o WhatsApp Web (Meta no lo cobra) y no desde el CRM, y el mismo dato mes por mes para evaluarlo.
// Sin lógica de datos: recibe el ahorro ya calculado (lib/meta-whatsapp/ahorro-celular.ts).
import type { AhorroCelular, AhorroMes } from "@/lib/meta-whatsapp/ahorro-celular";
import { formatUsd } from "@/lib/usd-format";

const mesNombre = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", month: "long", year: "numeric" });
const n = (x: number) => x.toLocaleString("es-MX");
// «Noviembre de 2026» (solo la primera letra en mayúscula).
const mes = (clave: string) => {
  const texto = mesNombre.format(new Date(`${clave}-01T12:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

export function CelularCard({ total, porMes }: { total: AhorroCelular; porMes: AhorroMes[] }) {
  const gratis = total.gratisAnuncio + total.gratisMil;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Celular y WhatsApp Web</h2>
          <p className="text-xs text-muted-foreground">
            Lo que un vendedor contesta desde el celular o WhatsApp Web no lo cobra Meta; desde el CRM sí se habría cobrado.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Ahorro del periodo</p>
          <p className="text-3xl font-semibold tabular-nums">≈ {formatUsd(total.ahorroUsd)}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{total.mensajes === 1 ? "1 mensaje" : `${n(total.mensajes)} mensajes`}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-xs">
        <li>
          Desde el CRM habrían sido gratis: <span className="tabular-nums">{n(gratis)}</span>
          <span className="text-muted-foreground">
            {" "}
            (por anuncio {n(total.gratisAnuncio)} · de los 1,000 del mes {n(total.gratisMil)})
          </span>
        </li>
        <li>
          Desde el CRM habrían costado: <span className="tabular-nums">{n(total.normales)}</span> mensajes normales ·{" "}
          <span className="tabular-nums">{n(total.plantillas)}</span> plantillas (el chat ya estaba cerrado)
        </li>
        <li className={total.cobradosMeta > 0 ? "font-semibold text-brand-orange" : "text-muted-foreground"}>
          {total.cobradosMeta > 0
            ? `Meta marcó ${n(total.cobradosMeta)} como cobrados: esos no fueron ahorro.`
            : "Meta no ha marcado ninguno como cobrado."}
        </li>
      </ul>
      {porMes.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Mes</th>
              <th className="py-1 text-right font-medium">Mensajes</th>
              <th className="py-1 text-right font-medium">Ahorro</th>
              <th className="py-1 text-right font-medium">Cobrados por Meta</th>
            </tr>
          </thead>
          <tbody>
            {porMes.map((m) => (
              <tr key={m.mes} className="border-t">
                <td className="py-1">{mes(m.mes)}</td>
                <td className="py-1 text-right tabular-nums">{n(m.mensajes)}</td>
                <td className="py-1 text-right tabular-nums">≈ {formatUsd(m.ahorroUsd)}</td>
                <td className={`py-1 text-right tabular-nums ${m.cobradosMeta > 0 ? "font-semibold text-brand-orange" : ""}`}>{n(m.cobradosMeta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
