import { describe, expect, it } from "vitest";
import { detectMagic } from "@/lib/chat-attachments/sniff";
import { OCTET, previewOf, trustedMediaMime, verifiedMediaMime } from "./media-type";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p)));

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "IHDR");
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const GIF = bytes("GIF89a", [1, 0]);
const PDF = bytes("%PDF-1.7\n");
const MP4 = bytes([0, 0, 0, 0x20], "ftypisom", [0, 0, 2, 0]);
const M4A = bytes([0, 0, 0, 0x20], "ftypM4A ", [0, 0, 2, 0]);
const GP3 = bytes([0, 0, 0, 0x18], "ftyp3gp4", [0, 0, 2, 0]);
const MOV = bytes([0, 0, 0, 0x14], "ftypqt  ", [0, 0, 2, 0]);
const HEIC = bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0]);
const OGG = bytes("OggS", [0, 2]);
const MP3_ID3 = bytes("ID3", [4, 0]);
const MP3_FRAME = bytes([0xff, 0xfb, 0x90, 0x44]);
const AAC = bytes([0xff, 0xf1, 0x50, 0x80]);
const AMR = bytes("#!AMR\n");
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f]);
const HTML = bytes("<!doctype html><script>alert(1)</script>");
const EXE = bytes("MZ", [0x90, 0]);

describe("detectMagic (formato real por bytes, sin nombre)", () => {
  it("reconoce imágenes, PDF, contenedores de audio/video y documentos de Office", () => {
    expect([JPEG, PNG, WEBP, GIF, PDF].map(detectMagic)).toEqual(["jpeg", "png", "webp", "gif", "pdf"]);
    expect([MP4, M4A, GP3, MOV, HEIC, WEBM].map(detectMagic)).toEqual(["mp4", "m4a", "3gp", "quicktime", "heif", "webm"]);
    expect([OGG, MP3_ID3, MP3_FRAME, AAC, AMR].map(detectMagic)).toEqual(["ogg", "mp3", "mp3", "aac", "amr"]);
  });
  it("HTML, ejecutables y vacío no son ningún formato conocido", () => {
    expect([HTML, EXE, new Uint8Array()].map(detectMagic)).toEqual([null, null, null]);
  });
});

describe("verifiedMediaMime (lo que el CRM muestra)", () => {
  it("foto, sticker, nota de voz, video y PDF verificados se muestran con su tipo real", () => {
    expect(verifiedMediaMime(JPEG, "image")).toBe("image/jpeg");
    expect(verifiedMediaMime(WEBP, "sticker")).toBe("image/webp");
    expect(verifiedMediaMime(OGG, "audio")).toBe("audio/ogg");
    expect(verifiedMediaMime(M4A, "audio")).toBe("audio/mp4");
    expect(verifiedMediaMime(MP4, "audio")).toBe("audio/mp4");
    expect(verifiedMediaMime(MP4, "video")).toBe("video/mp4");
    expect(verifiedMediaMime(GP3, "video")).toBe("video/3gpp");
    expect(verifiedMediaMime(PDF, "document")).toBe("application/pdf");
  });
  it("un «PDF» que es HTML, o bytes que no cuadran con el tipo de mensaje, quedan como descarga", () => {
    expect(verifiedMediaMime(HTML, "document")).toBe(OCTET);
    expect(verifiedMediaMime(HTML, "image")).toBe(OCTET);
    expect(verifiedMediaMime(PDF, "image")).toBe(OCTET);
    expect(verifiedMediaMime(JPEG, "document")).toBe(OCTET); // foto mandada como documento: se descarga, como hoy
    expect(verifiedMediaMime(MOV, "video")).toBe(OCTET);
    expect(verifiedMediaMime(HEIC, "image")).toBe(OCTET);
  });
});

describe("trustedMediaMime (archivos que salen del CRM)", () => {
  it("acepta el MIME si es de los que se muestran para ese tipo; si no, descarga", () => {
    expect(trustedMediaMime("image", "image/jpeg")).toBe("image/jpeg");
    expect(trustedMediaMime("video", "Video/MP4; codecs=avc1")).toBe("video/mp4");
    expect(trustedMediaMime("document", "application/pdf")).toBe("application/pdf");
    expect(trustedMediaMime("document", "text/plain")).toBe(OCTET);
    expect(trustedMediaMime("image", "application/pdf")).toBe(OCTET);
  });
});

describe("previewOf", () => {
  it("de tipo verificado a vista; descarga o sin revisar = null", () => {
    expect(previewOf("image/png")).toBe("image");
    expect(previewOf("audio/ogg")).toBe("audio");
    expect(previewOf("video/mp4")).toBe("video");
    expect(previewOf("application/pdf")).toBe("pdf");
    expect(previewOf(OCTET)).toBeNull();
    expect(previewOf("text/html")).toBeNull();
    expect(previewOf(undefined)).toBeNull();
  });
});
