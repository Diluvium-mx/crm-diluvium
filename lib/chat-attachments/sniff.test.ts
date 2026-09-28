import { describe, expect, it } from "vitest";
import { sniffChatFile } from "./sniff";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p)));

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "IHDR");
const MP4 = bytes([0, 0, 0, 0x20], "ftypisom", [0, 0, 2, 0], "isomiso2avc1mp41");
const MOV = bytes([0, 0, 0, 0x14], "ftypqt  ", [0, 0, 2, 0]);
const HEIC = bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0], "mif1heic");
const PDF = bytes("%PDF-1.7\n%âãÏÓ");
const DOCX = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0], "[Content_Types].xml", "word/document.xml");
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0], "fotos/IMG_1.jpg");
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const GIF = bytes("GIF89a");
const XML = bytes([0xef, 0xbb, 0xbf], '\n<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante/>');

describe("sniffChatFile: el tipo REAL por los primeros bytes", () => {
  it("acepta cada tipo cuando los bytes coinciden con la extensión", () => {
    expect(sniffChatFile(JPEG, "foto.jpg")).toEqual({ ok: true, kind: "image", mime: "image/jpeg" });
    expect(sniffChatFile(PNG, "captura.png")).toEqual({ ok: true, kind: "image", mime: "image/png" });
    expect(sniffChatFile(MP4, "video.mp4")).toEqual({ ok: true, kind: "video", mime: "video/mp4" });
    expect(sniffChatFile(PDF, "cotizacion.pdf")).toMatchObject({ ok: true, kind: "document", mime: "application/pdf" });
    expect(sniffChatFile(DOCX, "contrato.docx")).toMatchObject({ ok: true, kind: "document" });
    expect(sniffChatFile(OLE, "viejo.xls")).toMatchObject({ ok: true, mime: "application/vnd.ms-excel" });
    expect(sniffChatFile(bytes("Hola\nlista de precios"), "notas.txt")).toEqual({ ok: true, kind: "document", mime: "text/plain" });
  });
  it("XML (con BOM y espacios) sale como documento de texto text/plain", () => {
    expect(sniffChatFile(XML, "factura.xml")).toEqual({ ok: true, kind: "document", mime: "text/plain" });
  });
  it("rechaza lo disfrazado: GIF como .jpg, ZIP como .docx, HEIC o QuickTime como .mp4, binario como .txt/.xml", () => {
    expect(sniffChatFile(GIF, "anim.jpg")).toMatchObject({ ok: false });
    expect(sniffChatFile(ZIP, "fotos.docx")).toMatchObject({ ok: false });
    expect(sniffChatFile(HEIC, "foto.mp4")).toMatchObject({ ok: false });
    expect(sniffChatFile(MOV, "iphone.mp4")).toMatchObject({ ok: false });
    expect(sniffChatFile(bytes([0x00, 0x01, 0x02]), "datos.txt")).toMatchObject({ ok: false });
    expect(sniffChatFile(bytes("no es xml"), "factura.xml")).toMatchObject({ ok: false });
    expect(sniffChatFile(JPEG, "foto.png")).toMatchObject({ ok: false });
  });
  it("extensiones no aceptadas se rechazan aunque los bytes sean válidos", () => {
    expect(sniffChatFile(GIF, "anim.gif")).toEqual({
      ok: false,
      message: "WhatsApp no acepta este archivo desde el CRM (.gif). Mándalo desde el celular o WhatsApp Web.",
    });
    expect(sniffChatFile(ZIP, "fotos.zip")).toMatchObject({ ok: false });
  });
  it("vacío se rechaza", () => {
    expect(sniffChatFile(new Uint8Array(), "a.pdf")).toMatchObject({ ok: false });
  });
});
