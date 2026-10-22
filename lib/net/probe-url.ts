// ¿Este enlace entrega el archivo? (envío blindado, 22-oct-2026). Pide SOLO el primer byte,
// igual que lo descargaría WhatsApp (sin encabezados de auth): un enlace firmado con una llave
// vieja responde 403 aquí y no minutos después como 131053 en el chat del cliente.
// Nunca lanza: devuelve el motivo para el log y el aviso.
export type ProbeResult = { ok: true } | { ok: false; reason: string };

const PROBE_TIMEOUT_MS = 8_000;

export async function probeUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  try {
    const res = await fetchImpl(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 200 || res.status === 206) return { ok: true };
    return { ok: false, reason: `respondió ${res.status}` };
  } catch (error) {
    return { ok: false, reason: `no respondió (${error instanceof Error ? error.message : String(error)})` };
  }
}
