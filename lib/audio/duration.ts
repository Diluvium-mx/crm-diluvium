// Duración de un audio leída del ARCHIVO (Agente IA parte 1, 26-sep-2026): el worker no
// transcribe audios de más de 10 minutos y WhatsApp no manda la duración. PURO (sin BD).
// Formatos: OGG (Opus/Vorbis: las notas de voz de WhatsApp), MP4/M4A/3GP, MP3, WAV y AMR.
// Cualquier otro, o un archivo dañado → null (el worker no transcribe lo que no puede medir).

const MAX_SAFE_HIGH_WORD = 0x1fffff;
// Relleno tolerado entre la etiqueta ID3v2 y el primer frame de un MP3.
const MP3_SYNC_WINDOW = 4_096;

type Box = {
  dataStart: number;
  end: number;
  type: string;
};

function hasAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) return false;

  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
  }

  return true;
}

function uint64FromWords(high: number, low: number): number | null {
  if (high > MAX_SAFE_HIGH_WORD) return null;
  return high * 0x1_0000_0000 + low;
}

function readUint64BE(view: DataView, offset: number): number | null {
  return uint64FromWords(view.getUint32(offset), view.getUint32(offset + 4));
}

function readGranule(view: DataView, offset: number): number | null | undefined {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  if (low === 0xffffffff && high === 0xffffffff) return undefined;
  return uint64FromWords(high, low);
}

function oggDuration(bytes: Uint8Array, view: DataView): number | null {
  if (bytes.length < 27) return null;

  const segmentCount = bytes[26];
  const packetStart = 27 + segmentCount;
  if (packetStart > bytes.length) return null;

  let firstPacketLength = 0;
  let firstPacketComplete = false;
  for (let index = 0; index < segmentCount; index += 1) {
    const segmentLength = bytes[27 + index];
    firstPacketLength += segmentLength;
    if (segmentLength < 255) {
      firstPacketComplete = true;
      break;
    }
  }
  if (!firstPacketComplete || packetStart + firstPacketLength > bytes.length) return null;

  let rate: number;
  let preSkip = 0;
  if (hasAscii(bytes, packetStart, "OpusHead")) {
    if (firstPacketLength < 12) return null;
    preSkip = view.getUint16(packetStart + 10, true);
    rate = 48_000;
  } else if (bytes[packetStart] === 1 && hasAscii(bytes, packetStart + 1, "vorbis")) {
    if (firstPacketLength < 16) return null;
    rate = view.getUint32(packetStart + 12, true);
    if (rate === 0) return null;
  } else {
    return null;
  }

  const firstSerial = view.getUint32(14, true);
  let lastGranule: number | null = null;
  let pageOffset = 0;

  while (pageOffset < bytes.length) {
    if (pageOffset + 27 > bytes.length || !hasAscii(bytes, pageOffset, "OggS")) break;

    const pageSegments = bytes[pageOffset + 26];
    const segmentTableEnd = pageOffset + 27 + pageSegments;
    if (segmentTableEnd > bytes.length) break;

    let bodyLength = 0;
    for (let index = pageOffset + 27; index < segmentTableEnd; index += 1) {
      bodyLength += bytes[index];
    }

    const pageEnd = segmentTableEnd + bodyLength;
    if (pageEnd > bytes.length) break;

    if (view.getUint32(pageOffset + 14, true) === firstSerial) {
      const granule = readGranule(view, pageOffset + 6);
      if (granule === null) return null;
      if (granule !== undefined) lastGranule = granule;
    }

    pageOffset = pageEnd;
  }

  if (lastGranule === null || lastGranule < preSkip) return null;
  return (lastGranule - preSkip) / rate;
}

function boxAt(bytes: Uint8Array, view: DataView, start: number, limit: number): Box | null {
  if (start + 8 > limit) return null;

  const size32 = view.getUint32(start);
  const type = String.fromCharCode(bytes[start + 4], bytes[start + 5], bytes[start + 6], bytes[start + 7]);
  let headerSize = 8;
  let size: number;

  if (size32 === 1) {
    if (start + 16 > limit) return null;
    const largeSize = readUint64BE(view, start + 8);
    if (largeSize === null) return null;
    headerSize = 16;
    size = largeSize;
  } else if (size32 === 0) {
    size = limit - start;
  } else {
    size = size32;
  }

  if (size < headerSize || size > limit - start) return null;
  return { dataStart: start + headerSize, end: start + size, type };
}

function mvhdDuration(view: DataView, box: Box): number | null {
  const start = box.dataStart;
  if (start + 4 > box.end) return null;

  const version = view.getUint8(start);
  if (version === 0) {
    if (start + 20 > box.end) return null;
    const timescale = view.getUint32(start + 12);
    if (timescale === 0) return null;
    return view.getUint32(start + 16) / timescale;
  }

  if (version === 1) {
    if (start + 32 > box.end) return null;
    const timescale = view.getUint32(start + 20);
    const duration = readUint64BE(view, start + 24);
    if (timescale === 0 || duration === null) return null;
    return duration / timescale;
  }

  return null;
}

function mp4Duration(bytes: Uint8Array, view: DataView): number | null {
  let offset = 0;

  while (offset < bytes.length) {
    const box = boxAt(bytes, view, offset, bytes.length);
    if (box === null) return null;

    if (box.type === "moov") {
      let childOffset = box.dataStart;
      while (childOffset < box.end) {
        const child = boxAt(bytes, view, childOffset, box.end);
        if (child === null) return null;
        if (child.type === "mvhd") return mvhdDuration(view, child);
        childOffset = child.end;
      }
      return null;
    }

    offset = box.end;
  }

  return null;
}

type Mp3Header = {
  bitrateKbps: number;
  channelMode: number;
  mpegVersion: 1 | 2 | 2.5;
  sampleRate: number;
  samplesPerFrame: number;
};

function mp3Header(bytes: Uint8Array, offset: number): Mp3Header | null {
  if (offset + 4 > bytes.length) return null;

  const byte1 = bytes[offset + 1];
  const byte2 = bytes[offset + 2];
  if (bytes[offset] !== 0xff || (byte1 & 0xe0) !== 0xe0) return null;

  const versionBits = (byte1 >> 3) & 0x03;
  const layerBits = (byte1 >> 1) & 0x03;
  const bitrateIndex = byte2 >> 4;
  const sampleRateIndex = (byte2 >> 2) & 0x03;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex < 1 || bitrateIndex > 14 || sampleRateIndex > 2) {
    return null;
  }

  const mpegVersion: 1 | 2 | 2.5 = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const mpeg1Bitrates = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2Bitrates = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const baseSampleRates = [44_100, 48_000, 32_000];
  const rateDivisor = mpegVersion === 1 ? 1 : mpegVersion === 2 ? 2 : 4;

  return {
    bitrateKbps: (mpegVersion === 1 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex - 1],
    channelMode: bytes[offset + 3] >> 6,
    mpegVersion,
    sampleRate: baseSampleRates[sampleRateIndex] / rateDivisor,
    samplesPerFrame: mpegVersion === 1 ? 1152 : 576,
  };
}

function id3v2Length(bytes: Uint8Array): number | null {
  if (!hasAscii(bytes, 0, "ID3")) return 0;
  if (bytes.length < 10) return null;

  let payloadSize = 0;
  for (let index = 6; index <= 9; index += 1) {
    const value = bytes[index];
    if ((value & 0x80) !== 0) return null;
    payloadSize = payloadSize * 128 + value;
  }

  const total = 10 + payloadSize + ((bytes[5] & 0x10) !== 0 ? 10 : 0);
  return total <= bytes.length ? total : null;
}

function mp3Duration(bytes: Uint8Array, view: DataView): number | null {
  const tagLength = id3v2Length(bytes);
  if (tagLength === null) return null;

  // El primer frame va al inicio (o poco después de la etiqueta ID3). Buscarlo en todo
  // el archivo "encontraría" un encabezado falso dentro de cualquier formato desconocido
  // (WebM, AAC…) y daría una duración inventada: fuera de esa ventana, null.
  const searchEnd = Math.min(bytes.length, tagLength > 0 ? tagLength + MP3_SYNC_WINDOW : 4);
  let frameOffset = -1;
  let header: Mp3Header | null = null;
  for (let offset = tagLength; offset + 4 <= searchEnd; offset += 1) {
    const candidate = mp3Header(bytes, offset);
    if (candidate !== null) {
      frameOffset = offset;
      header = candidate;
      break;
    }
  }
  if (frameOffset < 0 || header === null) return null;

  const mono = header.channelMode === 3;
  const xingOffset = header.mpegVersion === 1 ? (mono ? 21 : 36) : mono ? 13 : 21;
  const xing = frameOffset + xingOffset;
  if ((hasAscii(bytes, xing, "Xing") || hasAscii(bytes, xing, "Info")) && xing + 12 <= bytes.length) {
    const flags = view.getUint32(xing + 4);
    if ((flags & 1) !== 0) {
      const frames = view.getUint32(xing + 8);
      return (frames * header.samplesPerFrame) / header.sampleRate;
    }
  }

  const vbri = frameOffset + 36;
  if (hasAscii(bytes, vbri, "VBRI") && vbri + 18 <= bytes.length) {
    const frames = view.getUint32(vbri + 14);
    return (frames * header.samplesPerFrame) / header.sampleRate;
  }

  const id3v1Length = bytes.length >= 128 && hasAscii(bytes, bytes.length - 128, "TAG") ? 128 : 0;
  const audioBytes = bytes.length - tagLength - id3v1Length;
  if (audioBytes <= 0) return null;
  return (audioBytes * 8) / (header.bitrateKbps * 1000);
}

function wavDuration(bytes: Uint8Array, view: DataView): number | null {
  if (bytes.length < 12 || !hasAscii(bytes, 8, "WAVE")) return null;

  let byteRate: number | null = null;
  let dataSize: number | null = null;
  let offset = 12;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null;
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;

    if (hasAscii(bytes, offset, "fmt ")) {
      if (size < 12 || size > bytes.length - dataStart) return null;
      byteRate = view.getUint32(dataStart + 8, true);
      if (byteRate === 0) return null;
    } else if (hasAscii(bytes, offset, "data")) {
      if (size === 0 || size === 0xffffffff) {
        dataSize = bytes.length - dataStart;
      } else {
        if (size > bytes.length - dataStart) return null;
        dataSize = size;
      }
    } else if (size > bytes.length - dataStart) {
      return null;
    }

    if (byteRate !== null && dataSize !== null) return dataSize / byteRate;
    if ((size === 0 || size === 0xffffffff) && hasAscii(bytes, offset, "data")) break;

    const paddedSize = size + (size & 1);
    if (paddedSize > bytes.length - dataStart) return null;
    offset = dataStart + paddedSize;
  }

  return null;
}

function amrDuration(bytes: Uint8Array, headerLength: number, frameSizes: readonly number[]): number {
  let frames = 0;
  let offset = headerLength;

  while (offset < bytes.length) {
    const frameType = (bytes[offset] >> 3) & 0x0f;
    const frameLength = 1 + frameSizes[frameType];
    if (frameLength > bytes.length - offset) break;
    frames += 1;
    offset += frameLength;
  }

  return frames * 0.02;
}

export function audioDurationSeconds(bytes: Uint8Array, mimeType?: string | null): number | null {
  try {
    void mimeType;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (hasAscii(bytes, 0, "OggS")) return oggDuration(bytes, view);
    if (hasAscii(bytes, 4, "ftyp")) return mp4Duration(bytes, view);
    if (hasAscii(bytes, 0, "RIFF")) return wavDuration(bytes, view);
    if (hasAscii(bytes, 0, "#!AMR\n")) {
      return amrDuration(bytes, 6, [12, 13, 15, 17, 19, 20, 26, 31, 5, 6, 5, 5, 0, 0, 0, 0]);
    }
    if (hasAscii(bytes, 0, "#!AMR-WB\n")) {
      return amrDuration(bytes, 9, [17, 23, 32, 36, 40, 46, 50, 58, 60, 5, 0, 0, 0, 0, 0, 0]);
    }

    return mp3Duration(bytes, view);
  } catch {
    return null;
  }
}
