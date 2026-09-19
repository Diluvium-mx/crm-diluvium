import { describe, expect, it } from "vitest";
import type { MessageAttachment } from "@/lib/db/schema";
import { MEDIA_MAX_ATTEMPTS } from "@/lib/messaging/media-keys";
import { SEND_UNCONFIRMED } from "@/lib/messaging/rules";
import { attachmentView, avatarInitials, canRetry, fullName, messagePreview, sanitizeReferral } from "./format";

describe("avatarInitials / fullName", () => {
  it("toma la primera letra de nombre y apellido, ignorando emojis", () => {
    expect(avatarInitials("Ana", "López")).toBe("AL");
    expect(avatarInitials("🔥 ana", null)).toBe("A");
    expect(avatarInitials("🙂", null)).toBeNull();
  });
  it("nombre completo con o sin apellido", () => {
    expect(fullName("Ana", "López")).toBe("Ana López");
    expect(fullName("Ana", null)).toBe("Ana");
  });
});

describe("messagePreview", () => {
  it("texto: colapsa espacios y recorta a 120", () => {
    expect(messagePreview("text", "  hola\n  mundo ")).toBe("hola mundo");
    expect(messagePreview("text", "a".repeat(200))).toHaveLength(120);
  });
  it("adjunto sin texto: etiqueta con icono según el tipo", () => {
    expect(messagePreview("image", null)).toBe("📎 Foto");
    expect(messagePreview("document", "")).toBe("📄 Documento");
    expect(messagePreview("audio", null)).toBe("🎤 Audio");
    expect(messagePreview("video", null)).toBe("🎬 Video");
  });
});

describe("sanitizeReferral", () => {
  it("solo expone lo que muestra la tarjeta; nunca ctwa_clid ni ids", () => {
    expect(
      sanitizeReferral({
        ctwa_clid: "SECRETO",
        source_id: "ad_123",
        headline: "Portón automático",
        body: "Cotiza hoy",
        image_url: "https://cdn/x.jpg",
        source_url: "https://fb.com/ad",
        media_type: "image",
      }),
    ).toEqual({
      headline: "Portón automático",
      body: "Cotiza hoy",
      thumbnailUrl: "https://cdn/x.jpg",
      sourceUrl: "https://fb.com/ad",
      mediaType: "image",
    });
  });
  it("acepta camelCase y descarta URLs no https", () => {
    expect(sanitizeReferral({ headline: "H", thumbnailUrl: "http://inseguro/x.jpg" })).toEqual({
      headline: "H",
      body: null,
      thumbnailUrl: null,
      sourceUrl: null,
      mediaType: null,
    });
  });
  it("sin titular ni miniatura ni enlace no hay tarjeta", () => {
    expect(sanitizeReferral({ ctwa_clid: "x", source_id: "ad_1" })).toBeNull();
    expect(sanitizeReferral(null)).toBeNull();
  });
});

describe("attachmentView (estado de la media)", () => {
  const base: MessageAttachment = { type: "image", url: "https://cdn/x.jpg" };
  const now = new Date("2026-09-18T12:00:00Z");
  const recent = new Date("2026-09-18T11:59:00Z");

  it("ready cuando ya está en el bucket", () => {
    expect(attachmentView("m1", 0, { ...base, storageKey: "k" }, recent, now).state).toBe("ready");
  });
  it("processing mientras se descarga (pocos intentos, reciente)", () => {
    expect(attachmentView("m1", 0, { ...base, downloadAttempts: 2 }, recent, now).state).toBe("processing");
  });
  it("failed al agotar intentos o al caducar en Meta (30 días)", () => {
    expect(attachmentView("m1", 0, { ...base, downloadAttempts: MEDIA_MAX_ATTEMPTS }, recent, now).state).toBe("failed");
    const old = new Date("2026-08-01T00:00:00Z");
    expect(attachmentView("m1", 0, base, old, now).state).toBe("failed");
  });
  it("la url apunta a /api/media con el índice", () => {
    expect(attachmentView("m1", 3, base, recent, now).url).toBe("/api/media/m1/3");
  });
});

describe("canRetry", () => {
  const failedCrm = {
    direction: "out" as const,
    source: "crm",
    type: "text",
    status: "failed",
    providerMessageId: null,
    errorCode: "131056", // rechazo definitivo del proveedor (4xx)
  };
  it("un texto del CRM rechazado (4xx) y sin wamid se puede reintentar", () => {
    expect(canRetry(failedCrm)).toBe(true);
  });
  it("no si ya tiene wamid, no es del CRM, o no está fallido", () => {
    expect(canRetry({ ...failedCrm, providerMessageId: "wamid.x" })).toBe(false);
    expect(canRetry({ ...failedCrm, source: "business_app" })).toBe(false);
    expect(canRetry({ ...failedCrm, status: "sent" })).toBe(false);
  });
  it("un fallo ambiguo (sin confirmar / desconocido) NUNCA se reintenta", () => {
    expect(canRetry({ ...failedCrm, errorCode: SEND_UNCONFIRMED })).toBe(false);
    expect(canRetry({ ...failedCrm, errorCode: "send_unknown:network" })).toBe(false);
  });
});
