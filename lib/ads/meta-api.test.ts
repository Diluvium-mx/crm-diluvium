import { describe, expect, it } from "vitest";
import {
  adsManagerUrl,
  fetchMetaAd,
  MetaAdsNotConfiguredError,
  MetaApiError,
  metaApiConfigFromEnv,
  retryDelayMs,
  storyUrl,
} from "./meta-api";

type Call = { url: string; auth: string | null };

function graph(responses: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, auth: new Headers(init?.headers).get("authorization") });
    const id = new URL(u).pathname.split("/").pop()!;
    const r = responses[id] ?? { status: 404, body: { error: { message: "no existe", code: 100 } } };
    return Response.json(r.body, { status: r.status ?? 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

// Forma real vista en la cuenta "Diluvium" (24-sep-2026): anuncio de video del
// conjunto "08.JUL.26 TESTING" de la campaña "🔴LR / Mensajes / 09.MAR.26".
const AD = {
  id: "120250108412580604",
  name: "AC - Video 9",
  effective_status: "ACTIVE",
  account_id: "1058203117932599",
  adset: { id: "120250108412560604", name: "🔴LR / Mensajes / 08.JUL.26 TESTING" },
  campaign: { id: "120241916275200604", name: "🔴LR / Mensajes / 09.MAR.26" },
  creative: { id: "1729369541430837" },
};
const CREATIVE = {
  id: "1729369541430837",
  object_type: "VIDEO",
  title: "Protege tu Casa 🏠",
  body: "🌧 Ya viste cómo protege…",
  video_id: "1206767124908982",
  thumbnail_url: "https://scontent-ord5-1.xx.fbcdn.net/v/thumb.jpg",
  effective_object_story_id: "114715000320568_1452532606896168",
};

describe("fetchMetaAd", () => {
  it("anuncio → campaña, conjunto, nombre y creativo; el token va en el encabezado, nunca en la URL", async () => {
    const { calls, fetchImpl } = graph({
      [AD.id]: { body: AD },
      [CREATIVE.id]: { body: CREATIVE },
      "1206767124908982": { body: { title: "Protege tu Casa 🏠", length: 25.866, picture: "https://scontent.xx.fbcdn.net/p.jpg" } },
    });
    const info = await fetchMetaAd(AD.id, { token: "SECRETO", version: "v26.0", fetchImpl });
    expect(info).toMatchObject({
      adName: "AC - Video 9",
      campaignName: "🔴LR / Mensajes / 09.MAR.26",
      adsetName: "🔴LR / Mensajes / 08.JUL.26 TESTING",
      accountId: "1058203117932599",
      title: "Protege tu Casa 🏠",
      objectType: "VIDEO",
      videoId: "1206767124908982",
      videoTitle: "Protege tu Casa 🏠",
      videoLengthSeconds: 25.866,
      storyId: "114715000320568_1452532606896168",
    });
    expect(calls.map((c) => c.url.startsWith("https://graph.facebook.com/v26.0/"))).toEqual([true, true, true]);
    expect(calls.every((c) => c.auth === "Bearer SECRETO" && !c.url.includes("SECRETO"))).toBe(true);
    // Miniatura chica pero legible (la de por omisión es de 64×64); del video solo sus datos.
    expect(calls[1].url).toContain("thumbnail_width=320");
    expect(calls[2].url).toContain("fields=title%2Clength%2Cpicture");
    expect(calls[2].url).not.toContain("source");
    expect(info.raw.creative?.id).toBe(CREATIVE.id);
  });

  it("sin permiso sobre el video: lo demás sí se obtiene", async () => {
    const { fetchImpl } = graph({
      [AD.id]: { body: AD },
      [CREATIVE.id]: { body: CREATIVE },
      "1206767124908982": { status: 403, body: { error: { message: "Permissions error", code: 10 } } },
    });
    const info = await fetchMetaAd(AD.id, { token: "t", fetchImpl });
    expect(info.adName).toBe("AC - Video 9");
    expect(info.videoTitle).toBeNull();
    expect(info.videoError).toContain("código 10");
  });

  it("texto e imagen desde object_story_spec cuando no vienen arriba", async () => {
    const { fetchImpl } = graph({
      [AD.id]: { body: AD },
      [CREATIVE.id]: {
        body: { id: CREATIVE.id, object_story_spec: { link_data: { name: "Título", message: "Texto", picture: "https://x.fbcdn.net/p.jpg" } } },
      },
    });
    const info = await fetchMetaAd(AD.id, { token: "t", fetchImpl });
    expect(info).toMatchObject({ title: "Título", body: "Texto", imageUrl: "https://x.fbcdn.net/p.jpg" });
  });

  it("errores de Meta: token inválido, límite de uso y caída", async () => {
    const bad = graph({ [AD.id]: { status: 400, body: { error: { message: "Invalid OAuth access token", code: 190 } } } });
    const error = await fetchMetaAd(AD.id, { token: "t", fetchImpl: bad.fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).isAuth).toBe(true);
    expect(retryDelayMs(error, 0)).toBe(6 * 3_600_000);
    expect(retryDelayMs(new MetaApiError(400, 17, "límite"), 0)).toBe(3_600_000);
    expect(retryDelayMs(new MetaApiError(503, 2, "caída"), 3)).toBe(8 * 60_000);
    expect(retryDelayMs(new MetaAdsNotConfiguredError("sin token"), 0)).toBe(10 * 60_000);
  });

  it("nunca arma una ruta con un id que no es de Meta", async () => {
    const { calls, fetchImpl } = graph({});
    await expect(fetchMetaAd("../me/accounts", { token: "t", fetchImpl })).rejects.toThrow(MetaApiError);
    expect(calls).toHaveLength(0);
  });
});

describe("configuración y enlaces", () => {
  it("sin META_ADS_ACCESS_TOKEN no está configurado; versión por omisión v26.0", () => {
    expect(() => metaApiConfigFromEnv({})).toThrow(MetaAdsNotConfiguredError);
    expect(metaApiConfigFromEnv({ META_ADS_ACCESS_TOKEN: "x" }).version).toBe("v26.0");
    expect(metaApiConfigFromEnv({ META_ADS_ACCESS_TOKEN: "x", META_GRAPH_API_VERSION: "v27.0" }).version).toBe("v27.0");
    expect(metaApiConfigFromEnv({ META_ADS_ACCESS_TOKEN: "x", META_GRAPH_API_VERSION: "latest" }).version).toBe("v26.0");
  });

  it("enlace al Administrador de anuncios y a la publicación", () => {
    expect(adsManagerUrl("120250108412580604", "1058203117932599")).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=120250108412580604&act=1058203117932599",
    );
    expect(storyUrl("114715000320568_1452532606896168")).toBe("https://www.facebook.com/114715000320568_1452532606896168");
    expect(storyUrl("javascript:x")).toBeNull();
  });
});
