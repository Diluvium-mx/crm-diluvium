import { describe, expect, it } from "vitest";
import {
  clickFromZernioConversation,
  conversationClickMatches,
  extractReferral,
  looksLikeAdMessage,
  normalizeReferral,
  referralThumbUrl,
  validAdId,
} from "./referral";

describe("extractReferral", () => {
  const ficha = { source_id: "120250108412580604" };

  it("raíz → metadata.referral → message.referral → message.metadata.referral", () => {
    expect(extractReferral({ referral: ficha, metadata: { referral: { source_id: "1" } } })).toEqual(ficha);
    expect(extractReferral({ metadata: { referral: ficha } })).toEqual(ficha);
    expect(extractReferral({ message: { referral: ficha } })).toEqual(ficha);
    expect(extractReferral({ message: { metadata: { referral: ficha } } })).toEqual(ficha);
  });

  it("acepta la ficha serializada como texto", () => {
    expect(extractReferral({ referral: JSON.stringify(ficha) })).toEqual(ficha);
  });

  it("vacía, nula o ilegible → undefined (sigue buscando en la siguiente)", () => {
    expect(extractReferral({ referral: {}, metadata: { referral: ficha } })).toEqual(ficha);
    expect(extractReferral({ referral: "{roto" })).toBeUndefined();
    expect(extractReferral(null)).toBeUndefined();
    expect(extractReferral({ referral: [ficha] })).toBeUndefined();
  });
});

describe("normalizeReferral", () => {
  it("WhatsApp completo (nombres de Meta)", () => {
    const data = normalizeReferral({
      source_url: "https://fb.me/abc123",
      source_type: "ad",
      source_id: "120211234567890123",
      headline: "Promoción de septiembre",
      body: "Escríbenos y te cotizamos",
      media_type: "video",
      video_url: "https://video.whatsapp.net/v.mp4",
      thumbnail_url: "https://scontent.whatsapp.net/t.jpg",
      ctwa_clid: "ARAk",
      welcome_message: { text: "¡Hola! ¿En qué te ayudamos?" },
    });
    expect(data).toMatchObject({
      platform: "whatsapp",
      adId: "120211234567890123",
      sourceType: "ad",
      sourceUrl: "https://fb.me/abc123",
      headline: "Promoción de septiembre",
      body: "Escríbenos y te cotizamos",
      mediaType: "video",
      videoUrl: "https://video.whatsapp.net/v.mp4",
      thumbnailUrl: "https://scontent.whatsapp.net/t.jpg",
      imageUrl: null,
      ctwaClid: "ARAk",
      welcomeMessage: "¡Hola! ¿En qué te ayudamos?",
    });
    // Miniatura del video (el video nunca se descarga).
    expect(referralThumbUrl(data)).toBe("https://scontent.whatsapp.net/t.jpg");
  });

  it("sin ctwa_clid e incompleta: lo que venga, sin inventar", () => {
    const data = normalizeReferral({ source_type: "ad" });
    expect(data.adId).toBeNull();
    expect(data.ctwaClid).toBeNull();
    expect(data.headline).toBeNull();
    expect(referralThumbUrl(data)).toBeNull();
  });

  it("source_type post: source_id es la publicación, no un anuncio", () => {
    const data = normalizeReferral({ source_type: "post", source_id: "1234567890" });
    expect(data.adId).toBeNull();
    expect(data.postId).toBe("1234567890");
  });

  it("links no https o ilegibles se descartan (no se descargan ni se muestran)", () => {
    const data = normalizeReferral({ image_url: "http://x.com/a.jpg", thumbnail_url: "javascript:alert(1)", source_url: "nota" });
    expect(data.imageUrl).toBeNull();
    expect(data.thumbnailUrl).toBeNull();
    expect(data.sourceUrl).toBeNull();
  });

  it("id de anuncio que no es numérico no se usa (ni en la API de Meta ni en URLs)", () => {
    expect(normalizeReferral({ source_id: "../../me" }).adId).toBeNull();
    expect(validAdId("120250108412580604")).toBe("120250108412580604");
    expect(validAdId("12")).toBeNull();
  });

  it("Instagram/Messenger (canales futuros): ad_id y ads_context_data", () => {
    const data = normalizeReferral(
      {
        ad_id: "120251044855190604",
        source: "ADS",
        type: "OPEN_THREAD",
        ref: "promo",
        ads_context_data: { ad_title: "IMG 14", photo_url: "https://scontent.cdninstagram.com/p.jpg", post_id: "999" },
      },
      "instagram",
    );
    expect(data).toMatchObject({
      platform: "instagram",
      adId: "120251044855190604",
      sourceType: "ADS",
      headline: "IMG 14",
      imageUrl: "https://scontent.cdninstagram.com/p.jpg",
      postId: "999",
      ref: "promo",
      ctwaClid: null,
    });
  });
});

describe("respaldo con la conversación de Zernio", () => {
  it("sin ctwa_* no hay clic", () => {
    expect(clickFromZernioConversation({ data: { id: "x", participants: [] } })).toBeNull();
    expect(clickFromZernioConversation(null)).toBeNull();
  });

  it("el clic corresponde al mensaje solo si se capturó cerca (Zernio guarda el PRIMER clic)", () => {
    const at = new Date("2026-09-24T18:00:00Z");
    const click = { referral: {}, capturedAt: new Date("2026-09-24T17:59:58Z") };
    expect(conversationClickMatches(click, at, false)).toBe(true);
    expect(conversationClickMatches({ ...click, capturedAt: new Date("2026-09-20T10:00:00Z") }, at, true)).toBe(false);
    expect(conversationClickMatches({ ...click, capturedAt: new Date("2026-09-24T20:00:00Z") }, at, false)).toBe(false);
    // Sin fecha de captura: solo si el mensaje trae señales de anuncio.
    expect(conversationClickMatches({ referral: {}, capturedAt: null }, at, true)).toBe(true);
    expect(conversationClickMatches({ referral: {}, capturedAt: null }, at, false)).toBe(false);
  });
});

describe("looksLikeAdMessage", () => {
  it("etiquetas de metadata de Facebook pegadas al texto (como llegaban a GHL)", () => {
    expect(looksLikeAdMessage("Hola\nctwaClid: ARAk\nsourceType: ad", undefined)).toBe(true);
    expect(looksLikeAdMessage("source_id: 1202", undefined)).toBe(true);
  });

  it("llaves de anuncio en la metadata del proveedor", () => {
    expect(looksLikeAdMessage("Hola", { ctwa_clid: "x" })).toBe(true);
    expect(looksLikeAdMessage("Hola", { quotedMessageId: "w" })).toBe(false);
  });

  it("un mensaje normal no parece anuncio", () => {
    expect(looksLikeAdMessage("¿Cuánto cuesta la compuerta de 90 cm?", null)).toBe(false);
  });
});
