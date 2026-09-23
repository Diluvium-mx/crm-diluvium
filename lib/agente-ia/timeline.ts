// Intercala los avisos del agente con los mensajes del hilo por hora. Puro y
// seguro para el cliente (lo usa chat-thread.tsx). Los mensajes llegan ya en
// orden; un aviso va después del último mensaje anterior o igual a su hora.
export type TimelineItem<R, N> = { kind: "row"; row: R } | { kind: "notice"; notice: N };

export function interleaveNotices<R extends { sentAt: Date | string }, N extends { createdAt: Date | string }>(
  rows: readonly R[],
  notices: readonly N[],
  // Hay mensajes más viejos sin cargar: un aviso anterior al primer mensaje cargado
  // pertenece a esa parte del hilo y no se muestra (aparecería fuera de lugar).
  hasOlder: boolean,
): TimelineItem<R, N>[] {
  const time = (d: Date | string) => new Date(d).getTime();
  const sorted = [...notices].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  const first = rows.length > 0 ? time(rows[0].sentAt) : null;
  const pending = hasOlder && first !== null ? sorted.filter((n) => time(n.createdAt) >= first) : sorted;
  const out: TimelineItem<R, N>[] = [];
  let i = 0;
  for (const row of rows) {
    while (i < pending.length && time(pending[i].createdAt) < time(row.sentAt)) out.push({ kind: "notice", notice: pending[i++] });
    out.push({ kind: "row", row });
  }
  while (i < pending.length) out.push({ kind: "notice", notice: pending[i++] });
  return out;
}
