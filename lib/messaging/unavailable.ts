// Mensaje "no disponible" (visto en el número oficial, 27-sep-2026): con
// coexistencia, Meta a veces avisa primero que un entrante no está disponible
// (código 131060, sin contenido) y un instante después manda el mensaje REAL
// con el MISMO wamid. Zernio reenvía ambos tal cual: el aviso llega con texto
// "[Unsupported message]" y `metadata.unsupported` ({ code, title, details }).
// El índice único por wamid descartaba el segundo como duplicado; ahora el
// aviso se COMPLETA con el contenido real (lib/messaging/ingest.ts).

/** ¿Es el aviso vacío de Meta (metadata.unsupported), no un mensaje con contenido? */
export function isUnavailableNotice(metadata: Record<string, unknown> | null | undefined): boolean {
  const notice = metadata?.unsupported;
  return typeof notice === "object" && notice !== null;
}

/**
 * Metadata del mensaje ya completado: se conserva lo que ya tenía (p. ej. el
 * respaldo del anuncio), se suma la del mensaje real y la marca "no disponible"
 * se guarda aparte con la hora en que se completó (ya no cuenta como aviso).
 */
export function completedMetadata(
  previous: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
  completedAt: Date,
): Record<string, unknown> {
  const { unsupported, ...rest } = previous ?? {};
  const notice = typeof unsupported === "object" && unsupported !== null ? unsupported : {};
  return {
    ...rest,
    ...(incoming ?? {}),
    noDisponibleAntes: { ...notice, completadoEn: completedAt.toISOString() },
  };
}
