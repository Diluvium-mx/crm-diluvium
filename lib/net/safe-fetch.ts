// Descargas de una URL que viene de afuera (adjuntos de WhatsApp/Instagram, miniaturas de anuncios),
// seguridad B (9-oct-2026, hallazgo SSRF de la revisión del 7-oct). Antes se exigía https y se
// seguía cualquier redirección: un link manipulado podía hacer que el servidor pidiera una dirección
// interna (Postgres, Redis, la red privada de Railway, el servicio de metadatos). Ahora, en CADA
// salto: solo https a un dominio con nombre (nunca una IP escrita, localhost ni .internal/.local),
// el dominio se resuelve y si CUALQUIERA de sus direcciones es privada, local o reservada no se
// pide; las redirecciones se siguen a mano (máximo MAX_REDIRECTS) y los encabezados se calculan
// por destino (`headersFor`): la llave de Zernio nunca viaja a otro dominio.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_REDIRECTS = 5;

/**
 * De dónde llegan los adjuntos y las miniaturas (9-oct-2026, visto en producción: zernio.com,
 * lookaside.fbsbx.com y www.instagram.com; más los CDN de Meta, Instagram y WhatsApp). El PRIMER
 * link tiene que ser de uno de estos dominios (o un subdominio); las redirecciones solo tienen que
 * ir a un dominio público (no se sabe a qué CDN redirige cada proveedor).
 */
export const MEDIA_HOSTS = ["zernio.com", "fbsbx.com", "fbcdn.net", "cdninstagram.com", "instagram.com", "whatsapp.net", "facebook.com"] as const;

export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
}

export type ResolveHost = (host: string) => Promise<string[]>;

export const resolveHost: ResolveHost = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || // «esta» red
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // enlace local y metadatos de la nube
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24 y 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19)) || // pruebas de red
    a >= 224 // multicast y reservadas
  );
}

/** ¿La dirección es privada, local o reservada (no se le pide nada)? */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind !== 6) return true;
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Blocked(mapped[1]);
  return (
    v6 === "::" ||
    v6 === "::1" ||
    /^f[cd]/.test(v6) || // fc00::/7 (privadas; Railway usa fd..)
    /^fe[89ab]/.test(v6) || // fe80::/10 enlace local
    /^ff/.test(v6) || // multicast
    v6.startsWith("64:ff9b:") || // NAT64
    v6.startsWith("2001:db8:") // documentación
  );
}

/** Solo https a un host con nombre (nunca IP escrita, localhost ni red interna). Sin red: no resuelve. */
export function safeUrl(value: string | URL): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || isIP(host) || host === "localhost" || !host.includes(".")) return null;
  if (host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".localhost")) return null;
  return url;
}

async function assertPublic(url: URL, resolve: ResolveHost): Promise<void> {
  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch (error) {
    throw new UnsafeUrlError(`no se pudo resolver ${url.hostname}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (addresses.length === 0) throw new UnsafeUrlError(`${url.hostname} no tiene direcciones`);
  if (addresses.some(isBlockedAddress)) throw new UnsafeUrlError(`${url.hostname} apunta a una dirección interna`);
}

export async function safeFetch(
  url: string | URL,
  opts: {
    fetchImpl?: typeof fetch;
    resolve?: ResolveHost;
    headersFor?: (target: URL) => Record<string, string>;
    signal?: AbortSignal;
    maxRedirects?: number;
    /** Dominios permitidos para el PRIMER link (p. ej. MEDIA_HOSTS); sin esto, cualquiera público. */
    allowedHosts?: readonly string[];
  } = {},
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolve = opts.resolve ?? resolveHost;
  const max = opts.maxRedirects ?? MAX_REDIRECTS;
  let current = safeUrl(url);
  if (!current) throw new UnsafeUrlError("link no permitido (solo https a un dominio público)");
  if (opts.allowedHosts && !hostAllowed(current.hostname, opts.allowedHosts)) throw new UnsafeUrlError(`${current.hostname} no está en la lista de servidores permitidos`);
  for (let hop = 0; ; hop++) {
    await assertPublic(current, resolve);
    const res = await fetchImpl(current, { headers: opts.headersFor?.(current) ?? {}, signal: opts.signal, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    await res.body?.cancel().catch(() => undefined);
    if (hop >= max) throw new UnsafeUrlError(`demasiadas redirecciones (más de ${max})`);
    let next: URL | null;
    try {
      next = safeUrl(new URL(location, current));
    } catch {
      next = null;
    }
    if (!next) throw new UnsafeUrlError("una redirección lleva a un link no permitido");
    current = next;
  }
}
