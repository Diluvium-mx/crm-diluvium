// Miniatura de la Biblioteca hecha en el NAVEGADOR (30-sep-2026): foto o un cuadro del video,
// recortada al centro a 240×240 y guardada como JPEG chico (~10–20 KB). Sin servicios externos ni
// ffmpeg en el servidor. Solo corre en el navegador (canvas, <video>). Si algo falla devuelve null:
// Multimedia sigue mostrando el archivo como antes y se vuelve a intentar la próxima vez.

export const THUMBNAIL_SIZE = 240;
const FRAME_TIMEOUT_MS = 20_000;
export const VIDEO_FRAME_AT_S = 2;

function once(target: EventTarget, ok: string, fail: string): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(ok, () => resolve(), { once: true });
    target.addEventListener(fail, () => reject(new Error(fail)), { once: true });
  });
}

// Cuadro del segundo 2 (o de la mitad, si dura menos): los videos de instalación empiezan en blanco
// y a los 2 s ya se ven el logo y el título. Video ya en memoria.
async function videoFrame(blob: Blob): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = URL.createObjectURL(blob);
  const ready = once(video, "loadeddata", "error");
  await ready;
  const at = Math.min(VIDEO_FRAME_AT_S, (video.duration || 1) / 2);
  const seeked = once(video, "seeked", "error");
  video.currentTime = at;
  await seeked;
  return video;
}

async function toBase64(jpeg: Blob): Promise<string> {
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** JPEG 240×240 en base64 (sin "data:"), o null si el navegador no pudo leer el archivo. */
export async function makeThumbnail(blob: Blob, kind: "image" | "video"): Promise<string | null> {
  let video: HTMLVideoElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      let source: CanvasImageSource;
      let width: number;
      let height: number;
      if (kind === "image") {
        const bitmap = await createImageBitmap(blob);
        source = bitmap;
        width = bitmap.width;
        height = bitmap.height;
      } else {
        video = await videoFrame(blob);
        source = video;
        width = video.videoWidth;
        height = video.videoHeight;
      }
      if (!width || !height) return null;
      // Recorte al centro (lo mismo que object-cover en el cuadro de Multimedia).
      const side = Math.min(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = THUMBNAIL_SIZE;
      canvas.height = THUMBNAIL_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
      if ("close" in source && typeof source.close === "function") source.close();
      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
      return jpeg ? toBase64(jpeg) : null;
    })().catch(() => null);
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FRAME_TIMEOUT_MS);
    });
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    const v = video as HTMLVideoElement | null;
    if (v) {
      URL.revokeObjectURL(v.src);
      v.removeAttribute("src");
      v.load();
    }
  }
}
