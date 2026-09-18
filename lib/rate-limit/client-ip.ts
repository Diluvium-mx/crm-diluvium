// Resolución de la IP de cliente para el rate limiter por IP.
//
// SUPUESTO DOCUMENTADO (Railway, verificado en Fase 1):
// - x-real-ip está ROTO cuando el CDN (Fastly) de Railway está activo: trae
//   la IP del borde, no la del cliente. No se usa.
// - x-forwarded-for: el edge de Railway DESCARTA el x-forwarded-for que manda
//   el cliente y escribe el suyo, con la IP que se conectó al edge como
//   PRIMER valor (más a la izquierda). Los saltos internos posteriores
//   (Fastly, proxy de Railway, el propio `next start`) se AGREGAN a la
//   derecha. Por eso el índice por defecto es 0 (el de la izquierda): es
//   estable aunque cambie la cantidad de saltos internos.
// - Railway NO publica el CIDR de sus proxies, así que no se puede validar
//   la cadena con trustedProxies por rango (lo que haría Better Auth).
//
// Si algún día se pone un proxy propio delante (p. ej. Cloudflare), el
// primer valor pasa a ser el de ese proxy: ajustar RATE_LIMIT_XFF_INDEX
// (negativo = contando desde la derecha; -1 = el último) o leer el header
// propio de ese proveedor. Cómo verificarlo en staging: mandar ráfagas con
// `-H "X-Forwarded-For: <ip inventada distinta cada vez>"`; si el 429 llega
// igual al pasar el límite, el header del cliente no se está respetando.
import { isIP } from "node:net";

/**
 * Lee la IP de cliente de `x-forwarded-for` en la posición `index`
 * (>= 0 desde la izquierda, < 0 desde la derecha) y la normaliza para usarla
 * como clave. Devuelve `null` si el header falta o el valor no es una IP.
 */
export function clientIpFromHeaders(headers: Headers, index = 0): string | null {
  const raw = headers.get("x-forwarded-for");
  if (!raw) return null;
  const hops = raw
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const hop = index >= 0 ? hops[index] : hops[hops.length + index];
  if (!hop) return null;
  return normalizeIpForKey(hop);
}

/**
 * Normaliza una IP para usarla como clave del limiter:
 * - quita el puerto (`1.2.3.4:5678`, `[::1]:80`);
 * - IPv4 mapeada en IPv6 (`::ffff:1.2.3.4`) → IPv4;
 * - IPv6 → prefijo /64: un solo cliente suele controlar un /64 completo, así
 *   que limitar por dirección exacta dejaría rotar IPs sin límite.
 */
export function normalizeIpForKey(value: string): string | null {
  let ip = value.trim();
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) ip = bracketed[1];
  const v4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4WithPort) ip = v4WithPort[1];

  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return null;

  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];

  return ipv6Prefix64(ip);
}

function ipv6Prefix64(ip: string): string {
  let addr = ip.toLowerCase().split("%")[0]; // sin zona (fe80::1%eth0)

  // Cola IPv4 embebida (p. ej. 64:ff9b::1.2.3.4) → dos grupos hex.
  const v4Tail = addr.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4Tail) {
    const [a, b, c, d] = v4Tail.slice(1).map(Number);
    addr =
      addr.slice(0, -v4Tail[0].length) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }

  let groups: string[];
  if (addr.includes("::")) {
    const [head, tail] = addr.split("::");
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    groups = [...h, ...Array<string>(8 - h.length - t.length).fill("0"), ...t];
  } else {
    groups = addr.split(":");
  }

  return (
    groups
      .slice(0, 4)
      .map((g) => parseInt(g, 16).toString(16))
      .join(":") + "::/64"
  );
}
