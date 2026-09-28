import { describe, expect, it } from "vitest";
import {
  acceptedType,
  attachmentAcceptAttr,
  attachmentHelpText,
  CHAT_CAPTION_MAX,
  CHAT_MAX_FILES,
  ChatSendPlanError,
  jpgName,
  planFile,
  planSend,
  XML_COMO_TEXTO,
} from "./rules";

const MB = 1024 * 1024;

describe("planFile: tipos y límites de WhatsApp", () => {
  it("fotos JPG/PNG hasta 5 MB se suben tal cual", () => {
    expect(planFile({ name: "foto.JPG", size: 2 * MB })).toEqual({ ok: true, action: "upload", kind: "image", mime: "image/jpeg" });
    expect(planFile({ name: "captura.png", size: 5 * MB })).toEqual({ ok: true, action: "upload", kind: "image", mime: "image/png" });
  });
  it("HEIC, HEIF, WebP o fotos de más de 5 MB se convierten a JPG antes de subir", () => {
    for (const f of [{ name: "IMG_1234.HEIC", size: 3 * MB }, { name: "a.heif", size: MB }, { name: "b.webp", size: MB }, { name: "grande.jpg", size: 9 * MB }, { name: "grande.png", size: 6 * MB }]) {
      expect(planFile(f)).toEqual({ ok: true, action: "convert", kind: "image", mime: "image/jpeg" });
    }
  });
  it("video MP4 hasta 16 MB; más pesado se rechaza con el límite", () => {
    expect(planFile({ name: "instalacion.mp4", size: 16 * MB })).toMatchObject({ ok: true, kind: "video", mime: "video/mp4" });
    const big = planFile({ name: "largo.mp4", size: 17 * MB });
    expect(big).toMatchObject({ ok: false });
    expect(!big.ok && big.message).toContain("16.0 MB");
  });
  it("documentos PDF, Word, Excel, PowerPoint y TXT hasta 100 MB", () => {
    for (const name of ["a.pdf", "a.doc", "a.docx", "a.xls", "a.xlsx", "a.ppt", "a.pptx", "a.txt"]) {
      expect(planFile({ name, size: 100 * MB })).toMatchObject({ ok: true, kind: "document", action: "upload" });
    }
    expect(planFile({ name: "manual.pdf", size: 101 * MB })).toMatchObject({ ok: false });
  });
  it("GIF, ZIP, audio, .mov y lo demás: aviso claro con la extensión", () => {
    for (const [name, ext] of [["anim.gif", ".gif"], ["fotos.zip", ".zip"], ["nota.mp3", ".mp3"], ["voz.ogg", ".ogg"], ["iphone.mov", ".mov"], ["sin-extension", "sin extensión"]]) {
      const r = planFile({ name, size: 1000 });
      expect(r).toEqual({ ok: false, message: `WhatsApp no acepta este archivo desde el CRM (${ext}). Mándalo desde el celular o WhatsApp Web.` });
    }
  });
  it("archivo vacío se rechaza", () => {
    expect(planFile({ name: "vacio.pdf", size: 0 })).toMatchObject({ ok: false });
  });
});

describe("XML como documento de texto (una sola regla)", () => {
  it("XML sale como text/plain con su nombre original terminado en .xml", () => {
    expect(XML_COMO_TEXTO).toBe(true);
    expect(acceptedType("FACTURA-A123.XML")).toEqual({ kind: "document", mime: "text/plain" });
    expect(planFile({ name: "factura.xml", size: 40_000 })).toMatchObject({ ok: true, kind: "document", mime: "text/plain" });
  });
  it("la ayuda y el selector lo incluyen porque la regla está encendida", () => {
    expect(attachmentHelpText()).toBe(
      "Fotos (.jpg, .jpeg, .png, .heic), videos .mp4 de hasta 16 MB y documentos (.pdf, Word, Excel, PowerPoint, .txt, .xml) de hasta 100 MB. Máximo 10 archivos.",
    );
    expect(attachmentAcceptAttr().split(",")).toEqual(expect.arrayContaining([".xml", ".heic", ".mp4", ".pdf", ".docx"]));
  });
});

describe("planSend: orden, pie solo en el primero y máximo 10", () => {
  it("con texto, el texto va como pie del PRIMER archivo; el resto sin pie, en el mismo orden", () => {
    expect(planSend(["a", "b", "c"], "  Aquí van las fotos  ")).toEqual([
      { file: "a", caption: "Aquí van las fotos" },
      { file: "b", caption: null },
      { file: "c", caption: null },
    ]);
  });
  it("sin texto salen solo los archivos", () => {
    expect(planSend(["a", "b"], "   ").map((p) => p.caption)).toEqual([null, null]);
  });
  it("máximo 10 archivos y al menos 1", () => {
    expect(planSend(Array.from({ length: CHAT_MAX_FILES }, (_, i) => i), "")).toHaveLength(10);
    expect(() => planSend(Array.from({ length: 11 }, (_, i) => i), "")).toThrow(ChatSendPlanError);
    expect(() => planSend([], "hola")).toThrow(ChatSendPlanError);
  });
  it("el pie no pasa de 1,024 caracteres", () => {
    expect(planSend(["a"], "x".repeat(CHAT_CAPTION_MAX))[0].caption).toHaveLength(1024);
    expect(() => planSend(["a"], "x".repeat(CHAT_CAPTION_MAX + 1))).toThrow("1,024");
  });
});

describe("jpgName", () => {
  it("cambia la extensión a .jpg", () => {
    expect(jpgName("IMG_1234.HEIC")).toBe("IMG_1234.jpg");
    expect(jpgName("captura.png")).toBe("captura.jpg");
    expect(jpgName("foto")).toBe("foto.jpg");
  });
});
