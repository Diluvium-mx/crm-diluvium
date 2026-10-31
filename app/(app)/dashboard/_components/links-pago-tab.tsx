"use client";

// Pestaña «Links de pago» del ⚡ (30-oct-2026; reglas en lib/agente-ia/links-pago.ts): todos los links de
// Agente IA › Links de pago, también los «Solo vendedor». Al elegir uno se ven los dos mensajes que salen
// (el del link y, aparte, el de los datos de envío) y «Mandar» los envía en ese orden como mensajes del
// vendedor. A un número de fuera de México no se manda ninguno (los +1 sí): la lista sale apagada.
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { listLinksPagoDelChat, sendLinkPago, type LinksPagoDelChat } from "@/lib/actions/links-pago-chat";
import { mensajesLink, pesos } from "@/lib/agente-ia/links-pago";
import { matchesSearch } from "@/lib/text/search";

export function LinksPagoTab({
  conversationId,
  initialLinkId = null,
  onSent,
}: {
  conversationId: string;
  initialLinkId?: string | null;
  /** Salieron los mensajes: el ⚡ se cierra (los mensajes aparecen en el hilo). */
  onSent: () => void;
}) {
  const [data, setData] = useState<LinksPagoDelChat | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialLinkId);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listLinksPagoDelChat(conversationId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [conversationId]);

  const shown = useMemo(() => (data?.links ?? []).filter((l) => matchesSearch(l.nombre, query)), [data, query]);
  const selected = data?.links.find((l) => l.id === selectedId) ?? null;

  async function mandar() {
    if (!selected || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await sendLinkPago(conversationId, selected.id);
      if (r.ok) onSent();
      else setSendError(r.message);
    } catch {
      setSendError("No se pudo mandar el link; inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  }

  if (loadError) return <p className="py-4 text-center text-sm text-brand-orange">No se pudieron cargar los links de pago.</p>;
  if (data === null) return <p className="py-4 text-center text-sm text-muted-foreground">Cargando links de pago…</p>;
  if (data.links.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">No hay links de pago. Agrégalos en Agente IA › Links de pago.</p>;

  // Un link elegido: en lugar de la lista, sus dos mensajes y «Mandar» (como «← Volver a la lista» de 📄 Plantillas;
  // en el panel bajo del ⚡ la vista previa y el botón quedarían fuera de la vista debajo de la lista).
  if (selected && !data.bloqueo) {
    return (
      <div className="space-y-2">
        {/* «Mandar» arriba: siempre a la vista aunque los mensajes no quepan en el panel. */}
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setSelectedId(null)} className="rounded px-1.5 py-0.5 text-xs text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300">
            ← Volver a la lista
          </button>
          <button
            type="button"
            onClick={() => void mandar()}
            disabled={sending}
            className="rounded-md bg-brand-orange px-4 py-1.5 text-sm font-medium text-brand-white transition-colors hover:bg-brand-orange-light disabled:opacity-50"
          >
            {sending ? "Mandando…" : "Mandar"}
          </button>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold">{selected.nombre}</span>
          <span className="shrink-0 text-xs tabular-nums">
            {pesos(selected.monto)} · {selected.meses > 0 ? `${selected.meses} MSI` : "Contado"}
          </span>
        </div>
        {sendError && <p className="border-l-2 border-brand-orange pl-2 text-xs">{sendError}</p>}
        <div className="space-y-2 rounded-md border bg-muted/40 p-2" aria-label="Así le llega al cliente">
          <p className="text-xs font-medium text-muted-foreground">Así le llega al cliente, en este orden:</p>
          {mensajesLink(selected, data.textos).map((m, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="shrink-0 font-semibold text-brand-orange">{i + 1})</span>
              <p className="min-w-0 whitespace-pre-wrap break-words">{m}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.bloqueo && <p className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">⚠ {data.bloqueo}</p>}
      <label className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 focus-within:border-brand-navy focus-within:ring-2 focus-within:ring-brand-navy/30">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar link de pago"
          aria-label="Buscar link de pago"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {shown.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">Ningún link coincide con «{query.trim()}».</p>
      ) : (
        <ul className="space-y-1" aria-label="Links de pago">
          {shown.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                disabled={data.bloqueo !== null}
                onClick={() => {
                  setSelectedId(l.id);
                  setSendError(null);
                }}
                className="flex w-full min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:border-brand-navy hover:bg-brand-navy/5 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.nombre}</span>
                  {l.soloVendedor && <span className="block text-[11px] text-muted-foreground">Solo vendedor</span>}
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className="block font-semibold tabular-nums">{pesos(l.monto)}</span>
                  <span className="block text-muted-foreground">{l.meses > 0 ? `${l.meses} MSI` : "Contado"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
