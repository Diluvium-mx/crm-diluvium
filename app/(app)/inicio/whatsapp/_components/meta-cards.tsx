// Tres cifras del periodo (4-nov-2026): lo que cobró Meta, cuántos mensajes salieron gratis y de dónde viene la
// cifra. Sin lógica de datos: recibe el historial ya calculado (lib/dashboard/meta-whatsapp.ts).
import { metaFreshness, type MetaWhatsappHistory } from "@/lib/dashboard/meta-whatsapp";
import { formatUsd } from "@/lib/usd-format";

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString("es-MX")} ${many}`);

export function MetaCards({ history }: { history: MetaWhatsappHistory }) {
  const fresh = metaFreshness(history);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">Cobro de Meta</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{history.totalUsd === null ? "—" : formatUsd(history.totalUsd)}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{count(history.charged, "mensaje cobrado", "mensajes cobrados")}</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">Salieron gratis</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{history.free.toLocaleString("es-MX")}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {history.freeRows.length ? history.freeRows.map((r) => `${r.label}: ${r.total.toLocaleString("es-MX")}`).join(" · ") : "mensajes"}
        </p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">De dónde sale</p>
        <p className="mt-1 text-sm">Lo que Meta reporta del número, el mismo dato de su factura.</p>
        <p className={`mt-1 text-xs ${fresh.tone === "orange" ? "text-brand-orange" : "text-muted-foreground"}`}>{fresh.text}</p>
      </div>
    </div>
  );
}
