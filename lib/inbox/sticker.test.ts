import { describe, expect, it } from "vitest";
import type { MessageView } from "./types";
import { isBareSticker } from "./sticker";

type Bare = Parameters<typeof isBareSticker>[0];

function att(kind: MessageView["kind"]): MessageView["attachments"][number] {
  return { index: 0, kind, fileName: null, mimeType: null, state: "ready", url: "/api/media/m/0", downloadUrl: "/api/media/m/0?download=1", thumbnailUrl: null, sizeBytes: null, pageCount: null };
}

function msg(over: Partial<Bare> = {}): Bare {
  return { body: null, attachments: [att("sticker")], quoted: null, adReferral: null, deletedAt: null, noDisponible: null, location: null, contactCards: [], ...over };
}

describe("isBareSticker (sticker sin burbuja, tamaño fijo como WhatsApp)", () => {
  it("sticker solo: va sin burbuja", () => {
    expect(isBareSticker(msg())).toBe(true);
    expect(isBareSticker(msg({ body: "   " }))).toBe(true);
  });
  it("una foto nunca se pinta como sticker", () => {
    expect(isBareSticker(msg({ attachments: [att("image")] }))).toBe(false);
    expect(isBareSticker(msg({ attachments: [att("sticker"), att("image")] }))).toBe(false);
    expect(isBareSticker(msg({ attachments: [] }))).toBe(false);
  });
  it("con algo más que pintar dentro, conserva la burbuja", () => {
    expect(isBareSticker(msg({ body: "jaja" }))).toBe(false);
    expect(isBareSticker(msg({ quoted: { direction: "out", preview: "¿Usted tiene problemas de inundaciones?" } }))).toBe(false);
    expect(isBareSticker(msg({ deletedAt: new Date() }))).toBe(false);
    expect(isBareSticker(msg({ noDisponible: "verificando" }))).toBe(false);
    expect(isBareSticker(msg({ contactCards: ["Ana"] }))).toBe(false);
    expect(isBareSticker(msg({ location: { latitude: 23.2, longitude: -106.4, name: null, address: null } }))).toBe(false);
    expect(isBareSticker(msg({ adReferral: {} as MessageView["adReferral"] }))).toBe(false);
  });
});
