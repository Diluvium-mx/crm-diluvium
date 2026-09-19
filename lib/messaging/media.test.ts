import { describe, expect, it, vi } from "vitest";
import { sha256Base64, storageKeyFor } from "./media-keys";
import { ZernioProvider } from "./zernio";

describe("storageKeyFor", () => {
  it("llave determinista por organización/mensaje/índice, con nombre saneado", () => {
    expect(
      storageKeyFor("org1", "msg1", 0, { type: "document", url: "u", fileName: "Cotización ROBERT VAN VAZ.pdf" }),
    ).toBe("org/org1/messages/msg1/0-Cotizacio_n_ROBERT_VAN_VAZ.pdf");
    expect(storageKeyFor("org1", "msg1", 2, { type: "image", url: "u", providerMediaId: "1561199152449398" })).toBe(
      "org/org1/messages/msg1/2-1561199152449398",
    );
    expect(storageKeyFor("o", "m", 0, { type: "audio", url: "u", fileName: "../../etc/passwd" })).not.toContain("/etc/");
  });

  it("sha256 en base64 como lo manda WhatsApp", () => {
    expect(sha256Base64(new TextEncoder().encode("hola"))).toBe("siHZ27CDp/M0KNfCo8MZiuklYU1wIQ4ocWzKp81N23k=");
  });
});

describe("ZernioProvider.fetchMedia", () => {
  it("manda el Bearer SOLO al host de la API de Zernio", async () => {
    const fetchImpl = vi.fn(async () => new Response("x")) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "sk_secreta", webhookSecret: "s" }, fetchImpl);
    await p.fetchMedia("https://zernio.com/api/v1/whatsapp/media/123?accountId=a");
    await p.fetchMedia("https://evil.example.com/robar");
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].headers.Authorization).toBe("Bearer sk_secreta");
    expect(calls[1][1].headers.Authorization).toBeUndefined();
  });

  it("rechaza URLs que no son https", async () => {
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, vi.fn() as unknown as typeof fetch);
    await expect(p.fetchMedia("http://zernio.com/api/v1/whatsapp/media/1")).rejects.toThrow(/https/);
  });
});
