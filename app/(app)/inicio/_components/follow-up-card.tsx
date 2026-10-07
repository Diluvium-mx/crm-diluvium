// Tarjeta «Seguimientos del Agente IA» (docs/seguimientos.md, Parte 4): qué salió en el periodo y qué
// pasó en esos chats. Solo muestra datos (los arma lib/dashboard/seguimientos.ts).
import type { FollowUpStats } from "@/lib/dashboard/seguimientos";

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value.toLocaleString("es-MX")}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export function FollowUpCard({ stats, ensayo }: { stats: FollowUpStats; ensayo: boolean }) {
  return (
    <section className="rounded-lg border bg-card p-4" data-testid="follow-up-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Seguimientos del Agente IA</h2>
        <p className="text-xs text-muted-foreground">
          {ensayo ? "En ensayo: no se le manda nada al cliente (Agente IA › Opciones)." : "Chats que recibieron un seguimiento en el periodo."}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Tile label="Mensajes que salieron" value={stats.salieron} note={stats.fallaron > 0 ? `${stats.fallaron} no se entregaron` : undefined} />
        <Tile label="Chats" value={stats.chats} />
        <Tile label="Contestaron" value={stats.contestaron} note={`${pct(stats.contestaron, stats.chats)} % de los chats`} />
        <Tile label="Avanzaron de etapa" value={stats.avanzaron} note={`${pct(stats.avanzaron, stats.chats)} %`} />
        <Tile label="Compraron" value={stats.compraron} note={`${pct(stats.compraron, stats.chats)} %`} />
      </div>
      {stats.porCaso.length > 0 ? (
        <table className="mt-4 w-full table-fixed text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="w-[40%] pb-1 font-medium">Caso</th>
              <th className="pb-1 text-right font-medium">Chats</th>
              <th className="pb-1 text-right font-medium">Contestaron</th>
              <th className="pb-1 text-right font-medium">Avanzaron</th>
              <th className="pb-1 text-right font-medium">Compraron</th>
            </tr>
          </thead>
          <tbody>
            {stats.porCaso.map((c) => (
              <tr key={c.caso} className="border-t">
                <td className="truncate py-1.5">{c.label}</td>
                <td className="py-1.5 text-right tabular-nums">{c.chats}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {c.contestaron} <span className="text-xs text-muted-foreground">({pct(c.contestaron, c.chats)} %)</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{c.avanzaron}</td>
                <td className="py-1.5 text-right tabular-nums">{c.compraron}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Ningún seguimiento salió en este periodo.</p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Contestaron = el cliente escribió después del seguimiento (hasta 72 h después del último). Avanzaron = hoy está en una etapa más adelante que cuando
        salió el seguimiento (se mide desde el 6-oct-2026). Compraron = llegó a la etapa de venta cerrada después del seguimiento.
      </p>
    </section>
  );
}
