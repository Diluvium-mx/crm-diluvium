// Descargas seguras (seguridad B, 9-oct-2026): solo https a un dominio público, en CADA salto;
// nunca una dirección interna (aunque el dominio sea «bonito»), redirecciones a mano con tope y la
// llave solo para su dominio.
import { describe, expect, it } from "vitest";
import { hostAllowed, isBlockedAddress, MEDIA_HOSTS, safeFetch, safeUrl, UnsafeUrlError } from "./safe-fetch";

const dns = (map: Record<string, string[]>) => async (host: string) => {
  if (!map[host]) throw new Error("ENOTFOUND");
  return map[host];
};

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    expect(init?.redirect).toBe("manual");
    const route = routes[url];
    if (!route) throw new Error(`sin ruta ${url}`);
    return route();
  }) as typeof fetch;
  return { impl, calls };
}

const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
const ok = () => new Response("bytes", { status: 200 });

describe("isBlockedAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.10", "169.254.169.254", "100.100.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd12:3456::1", "fe80::1", "::ffff:10.0.0.1", "no-es-ip"])(
    "bloquea %s",
    (ip) => expect(isBlockedAddress(ip)).toBe(true),
  );
  it.each(["157.240.1.1", "31.13.71.36", "2a03:2880:f12f:83:face:b00c:0:25de", "::ffff:157.240.1.1"])("deja pasar %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe("safeUrl", () => {
  it.each(["http://x.fbcdn.net/a", "https://127.0.0.1/a", "https://[::1]/a", "https://localhost/a", "https://redis.railway.internal/a", "https://intranet/a", "no es url"])(
    "rechaza %s",
    (u) => expect(safeUrl(u)).toBeNull(),
  );
  it("acepta https a un dominio", () => expect(safeUrl("https://scontent.xx.fbcdn.net/v/a.jpg")?.hostname).toBe("scontent.xx.fbcdn.net"));
});

describe("hostAllowed", () => {
  it.each(["zernio.com", "lookaside.fbsbx.com", "scontent.xx.fbcdn.net", "www.instagram.com", "scontent.cdninstagram.com", "mmg.whatsapp.net"])("permite %s", (h) =>
    expect(hostAllowed(h, MEDIA_HOSTS)).toBe(true),
  );
  it.each(["evil.com", "zernio.com.evil.com", "notzernio.com", "fbcdn.net.attacker.io"])("rechaza %s", (h) => expect(hostAllowed(h, MEDIA_HOSTS)).toBe(false));
});

describe("safeFetch", () => {
  const resolve = dns({ "zernio.com": ["104.21.1.1"], "cdn.zernio.com": ["104.21.1.2"], "x.fbcdn.net": ["157.240.1.1"], "malo.example.com": ["10.0.0.5"] });

  it("sigue redirecciones a mano y la llave solo va a su dominio", async () => {
    const { impl, calls } = fakeFetch({
      "https://zernio.com/api/v1/whatsapp/media/1": redirect("https://x.fbcdn.net/f.jpg"),
      "https://x.fbcdn.net/f.jpg": ok,
    });
    const res = await safeFetch("https://zernio.com/api/v1/whatsapp/media/1", {
      fetchImpl: impl,
      resolve,
      headersFor: (t): Record<string, string> => (t.host === "zernio.com" ? { Authorization: "Bearer k" } : {}),
    });
    expect(res.status).toBe(200);
    expect(calls.map((c) => [c.url, c.headers.Authorization ?? null])).toEqual([
      ["https://zernio.com/api/v1/whatsapp/media/1", "Bearer k"],
      ["https://x.fbcdn.net/f.jpg", null],
    ]);
  });

  it("no pide un dominio que resuelve a una dirección interna", async () => {
    const { impl, calls } = fakeFetch({});
    await expect(safeFetch("https://malo.example.com/x", { fetchImpl: impl, resolve })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toHaveLength(0);
  });

  it("una redirección a una red interna, a http o a una IP se corta", async () => {
    for (const to of ["https://malo.example.com/x", "http://x.fbcdn.net/f.jpg", "https://169.254.169.254/latest/meta-data", "https://redis.railway.internal/"]) {
      const { impl } = fakeFetch({ "https://zernio.com/m": redirect(to) });
      await expect(safeFetch("https://zernio.com/m", { fetchImpl: impl, resolve })).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("tope de redirecciones y dominios que no resuelven", async () => {
    const { impl } = fakeFetch({ "https://zernio.com/a": redirect("https://cdn.zernio.com/b"), "https://cdn.zernio.com/b": redirect("https://zernio.com/a") });
    await expect(safeFetch("https://zernio.com/a", { fetchImpl: impl, resolve, maxRedirects: 3 })).rejects.toThrow(/demasiadas redirecciones/);
    await expect(safeFetch("https://no-existe.example.com/a", { fetchImpl: impl, resolve })).rejects.toThrow(/no se pudo resolver/);
  });

  it("redirección relativa: se resuelve contra el mismo dominio", async () => {
    const { impl, calls } = fakeFetch({ "https://cdn.zernio.com/a": redirect("/b"), "https://cdn.zernio.com/b": ok });
    expect((await safeFetch("https://cdn.zernio.com/a", { fetchImpl: impl, resolve })).status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(["https://cdn.zernio.com/a", "https://cdn.zernio.com/b"]);
  });
});
