import { describe, expect, it } from "vitest";
import { audioDurationSeconds } from "./duration";

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function setUint64BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, Math.floor(value / 0x1_0000_0000));
  view.setUint32(offset + 4, value >>> 0);
}

function oggPage(serial: number, granule: number | null, packet: Uint8Array = new Uint8Array()): Uint8Array {
  const segmentCount = Math.max(1, Math.ceil(packet.length / 255));
  const page = new Uint8Array(27 + segmentCount + packet.length);
  page.set(ascii("OggS"));
  const view = new DataView(page.buffer);
  if (granule === null) {
    view.setUint32(6, 0xffffffff, true);
    view.setUint32(10, 0xffffffff, true);
  } else {
    view.setUint32(6, granule >>> 0, true);
    view.setUint32(10, Math.floor(granule / 0x1_0000_0000), true);
  }
  view.setUint32(14, serial, true);
  page[26] = segmentCount;
  let remaining = packet.length;
  for (let index = 0; index < segmentCount; index += 1) {
    page[27 + index] = Math.min(255, remaining);
    remaining -= page[27 + index];
  }
  page.set(packet, 27 + segmentCount);
  return page;
}

function opusOgg(seconds: number, options: { extraStreams?: boolean; trailingUnset?: boolean } = {}): Uint8Array {
  const preSkip = 312;
  const head = new Uint8Array(19);
  head.set(ascii("OpusHead"));
  head[8] = 1;
  head[9] = 1;
  new DataView(head.buffer).setUint16(10, preSkip, true);

  const pages = [oggPage(7, 0, head), oggPage(7, 48_000 * seconds + preSkip)];
  if (options.trailingUnset) pages.push(oggPage(7, null));
  if (options.extraStreams) pages.push(oggPage(99, 48_000 * (seconds + 500)));
  return concat(...pages);
}

function vorbisOgg(seconds: number): Uint8Array {
  const head = new Uint8Array(30);
  head[0] = 1;
  head.set(ascii("vorbis"), 1);
  new DataView(head.buffer).setUint32(12, 44_100, true);
  return concat(oggPage(12, 0, head), oggPage(12, 44_100 * seconds));
}

function mp4Box(type: string, body: Uint8Array): Uint8Array {
  const result = new Uint8Array(8 + body.length);
  new DataView(result.buffer).setUint32(0, result.length);
  result.set(ascii(type), 4);
  result.set(body, 8);
  return result;
}

function mp4WithMvhd(version: 0 | 1, timescale: number, duration: number): Uint8Array {
  const payload = new Uint8Array(version === 0 ? 20 : 32);
  const view = new DataView(payload.buffer);
  payload[0] = version;
  if (version === 0) {
    view.setUint32(12, timescale);
    view.setUint32(16, duration);
  } else {
    view.setUint32(20, timescale);
    setUint64BE(view, 24, duration);
  }
  return concat(mp4Box("ftyp", ascii("M4A \u0000\u0000\u0000\u0000")), mp4Box("moov", mp4Box("mvhd", payload)));
}

function mp3Header(): Uint8Array {
  return Uint8Array.of(0xff, 0xfb, 0x10, 0x00);
}

function cbrMp3(): Uint8Array {
  const id3PayloadLength = 20;
  const tag = new Uint8Array(10 + id3PayloadLength);
  tag.set(ascii("ID3"));
  tag[9] = id3PayloadLength;

  const audio = new Uint8Array(8_000);
  audio.set(mp3Header());
  const id3v1 = new Uint8Array(128);
  id3v1.set(ascii("TAG"));
  return concat(tag, audio, id3v1);
}

function xingMp3(frames: number): Uint8Array {
  const audio = new Uint8Array(64);
  audio.set(Uint8Array.of(0xff, 0xfb, 0x90, 0x00));
  audio.set(ascii("Xing"), 36);
  const view = new DataView(audio.buffer);
  view.setUint32(40, 1);
  view.setUint32(44, frames);
  return audio;
}

function wav(byteRate: number, dataLength = 12_000): Uint8Array {
  const fmt = new Uint8Array(16);
  const fmtView = new DataView(fmt.buffer);
  fmtView.setUint16(0, 1, true);
  fmtView.setUint16(2, 1, true);
  fmtView.setUint32(4, byteRate, true);
  fmtView.setUint32(8, byteRate, true);
  fmtView.setUint16(12, 1, true);
  fmtView.setUint16(14, 8, true);

  const fmtChunk = concat(ascii("fmt "), Uint8Array.of(16, 0, 0, 0), fmt);
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, dataLength, true);
  const dataChunk = concat(ascii("data"), size, new Uint8Array(dataLength));
  const result = concat(ascii("RIFF"), new Uint8Array(4), ascii("WAVE"), fmtChunk, dataChunk);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}

function amrNb(frameCount: number): Uint8Array {
  const frame = new Uint8Array(32);
  frame[0] = 7 << 3;
  const frames = new Uint8Array(frame.length * frameCount);
  for (let index = 0; index < frameCount; index += 1) frames.set(frame, index * frame.length);
  return concat(ascii("#!AMR\n"), frames);
}

describe("audioDurationSeconds", () => {
  it("lee Opus OGG, ignora granules sin valor y otros streams lógicos", () => {
    expect(audioDurationSeconds(opusOgg(65, { trailingUnset: true, extraStreams: true }))).toBeCloseTo(65);
  });

  it("lee Vorbis OGG a 44100 Hz", () => {
    expect(audioDurationSeconds(vorbisOgg(2.5))).toBeCloseTo(2.5);
  });

  it("lee mvhd versión 0 de MP4", () => {
    expect(audioDurationSeconds(mp4WithMvhd(0, 1_000, 12_500))).toBeCloseTo(12.5);
  });

  it("lee mvhd versión 1 de MP4", () => {
    expect(audioDurationSeconds(mp4WithMvhd(1, 90_000, 1_125_000))).toBeCloseTo(12.5);
  });

  it("calcula MP3 CBR excluyendo ID3v2 e ID3v1", () => {
    expect(audioDurationSeconds(cbrMp3())).toBeCloseTo(2);
  });

  it("usa el conteo de frames de Xing para MP3", () => {
    expect(audioDurationSeconds(xingMp3(100))).toBeCloseTo((100 * 1152) / 44_100);
  });

  it("lee WAV mediante dataSize y byteRate", () => {
    expect(audioDurationSeconds(wav(8_000))).toBeCloseTo(1.5);
  });

  it("cuenta frames AMR-NB de 20 ms", () => {
    expect(audioDurationSeconds(amrNb(3_000))).toBeCloseTo(60);
  });

  it("devuelve null para entradas desconocidas, corruptas o incompletas", () => {
    expect(audioDurationSeconds(new Uint8Array())).toBeNull();
    expect(audioDurationSeconds(Uint8Array.of(1, 2, 3, 4), "audio/ogg")).toBeNull();
    expect(audioDurationSeconds(ascii("OggS"))).toBeNull();
    expect(audioDurationSeconds(mp4Box("ftyp", ascii("M4A ")))).toBeNull();
    expect(audioDurationSeconds(wav(0))).toBeNull();
  });

  it("no inventa un MP3 con un sync suelto a la mitad de un archivo desconocido (WebM, AAC…)", () => {
    const webm = new Uint8Array(5_000);
    webm.set(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3));
    webm.set(Uint8Array.of(0xff, 0xfb, 0x10, 0x00), 2_000);
    expect(audioDurationSeconds(webm)).toBeNull();
  });

  it("nunca lanza al truncar un OGG válido en cualquier byte", () => {
    const valid = opusOgg(3);
    for (let length = 0; length <= valid.length; length += 1) {
      expect(() => audioDurationSeconds(valid.slice(0, length))).not.toThrow();
    }
  });

  it("distingue un Opus de más de diez minutos", () => {
    expect(audioDurationSeconds(opusOgg(601))).toBeGreaterThan(600);
  });
});
