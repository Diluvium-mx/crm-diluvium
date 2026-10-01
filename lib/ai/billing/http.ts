// GET a los reportes de cobro de los proveedores de IA. Solo LEEN reportes: no llaman a ningún
// modelo ni gastan tokens. El error nunca lleva la llave (va en la cabecera, no en la URL) y el
// cuerpo de la respuesta se recorta y se limpia por si el proveedor repitiera algo parecido.
export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

const TIMEOUT_MS = 20_000;
const BODY_PREVIEW = 200;

export class BillingHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BillingHttpError";
  }
}

// Quita cualquier cosa con forma de llave (sk-…, xai-…) de un texto de error.
export function redactKeys(text: string): string {
  return text.replace(/\b(sk-[A-Za-z0-9_-]{4,}|xai-[A-Za-z0-9_-]{4,})/g, "[llave oculta]");
}

export async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown> {
  const host = new URL(url).host;
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.text();
  if (!res.ok) {
    throw new BillingHttpError(res.status, `${host} respondió ${res.status}: ${redactKeys(body.replace(/\s+/g, " ")).slice(0, BODY_PREVIEW)}`);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new BillingHttpError(res.status, `${host} respondió algo que no es JSON`);
  }
}
