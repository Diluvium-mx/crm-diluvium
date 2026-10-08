// Qué archivos son del contacto (al borrar) y cuáles van en el zip (al exportar). ARCO, 7-oct-2026.
import { describe, expect, it } from "vitest";
import { clientFiles, megabytes, totalBytes } from "./export-files";
import { hasUnstoredAttachment, isOwnMessageKey, ownKeysToDelete, ownOriginalKeys } from "./keys";

const ORG = "org_1";

describe("archivos propios del contacto", () => {
  it("solo recibidos y adjuntos del chat de ESA organización; nunca la Biblioteca", () => {
    expect(isOwnMessageKey(ORG, "org/org_1/messages/m1/0-foto.jpg")).toBe(true);
    expect(isOwnMessageKey(ORG, "org/org_1/chat/2026-10-03/u1-cotizacion.pdf")).toBe(true);
    expect(isOwnMessageKey(ORG, "org/org_1/library/a1-tabla.jpg")).toBe(false);
    expect(isOwnMessageKey(ORG, "org/org_1/ads/meta/1/miniatura.jpg")).toBe(false);
    expect(isOwnMessageKey(ORG, "org/org_2/messages/m1/0-foto.jpg")).toBe(false);
    expect(isOwnMessageKey(ORG, "org/org_1/messages/../library/a1-tabla.jpg")).toBe(false);
    expect(isOwnMessageKey(ORG, "")).toBe(false);
  });

  it("originales y miniaturas, sin repetir; la Biblioteca (y su miniatura) no", () => {
    const attachments = [
      { storageKey: "org/org_1/messages/m1/0-doc.pdf", thumbnailKey: "org/org_1/messages/m1/0-doc.pdf.thumb.png" },
      { storageKey: "org/org_1/library/a1-tabla.pdf", thumbnailKey: "org/org_1/library/a1-tabla.pdf.thumb.png" },
      { storageKey: "org/org_1/messages/m1/0-doc.pdf" },
    ];
    expect(ownKeysToDelete(ORG, attachments)).toEqual(["org/org_1/messages/m1/0-doc.pdf", "org/org_1/messages/m1/0-doc.pdf.thumb.png"]);
    expect(ownOriginalKeys(ORG, attachments)).toEqual(["org/org_1/messages/m1/0-doc.pdf"]);
  });

  it("descarga pendiente: un adjunto con archivo y sin copia anotada", () => {
    expect(hasUnstoredAttachment([{ providerMediaId: "wamid-media" }])).toBe(true);
    expect(hasUnstoredAttachment([{ url: "https://zernio/media/1" }])).toBe(true);
    expect(hasUnstoredAttachment([{ storageKey: "org/org_1/messages/m1/0-a.jpg" }])).toBe(false);
    expect(hasUnstoredAttachment([{ url: "" }])).toBe(false);
  });
});

describe("archivos del zip", () => {
  it("solo los que mandó el cliente, ya guardados, con nombre único en hora de Mazatlán", () => {
    const at = new Date("2026-10-03T17:12:00Z");
    const files = clientFiles(ORG, [
      {
        id: "m1",
        direction: "in",
        at,
        attachments: [
          { type: "image", mimeType: "image/jpeg", storageKey: "org/org_1/messages/m1/0-a.jpg", sizeBytes: 1000 },
          { type: "document", fileName: "INE frente.pdf", storageKey: "org/org_1/messages/m1/1-INE.pdf", sizeBytes: 2000 },
          { type: "audio" },
        ],
      },
      { id: "m2", direction: "out", at, attachments: [{ type: "image", storageKey: "org/org_1/library/a1-tabla.jpg", sizeBytes: 9 }] },
      { id: "m3", direction: "out", at, attachments: [{ type: "document", storageKey: "org/org_1/chat/2026-10-03/u1-c.pdf", sizeBytes: 9 }] },
    ]);
    expect(files).toEqual([
      { messageId: "m1", index: 0, key: "org/org_1/messages/m1/0-a.jpg", zipPath: "archivos/2026-10-03_1012_1-foto.jpg", bytes: 1000 },
      { messageId: "m1", index: 1, key: "org/org_1/messages/m1/1-INE.pdf", zipPath: "archivos/2026-10-03_1012_2-INE_frente.pdf", bytes: 2000 },
    ]);
    expect(totalBytes(files)).toBe(3000);
    expect(megabytes(0)).toBe("0 MB");
    expect(megabytes(1)).toBe("1 MB");
    expect(megabytes(300 * 1024 * 1024 + 1)).toBe("301 MB");
  });
});
