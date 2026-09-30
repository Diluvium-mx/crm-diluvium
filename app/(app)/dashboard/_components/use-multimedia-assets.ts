"use client";

// Lista de Multimedia sin espera (30-sep-2026):
// - se pide en cuanto se abre el 📎 (prefetchMultimedia), antes de tocar «Multimedia»;
// - se guarda en memoria mientras la página esté abierta: al abrir Multimedia sale al instante y se
//   revisa en segundo plano si cambió algo en la Biblioteca;
// - las miniaturas llegan CON la lista (JPEG chico en la ficha), así que no se descarga ningún archivo.
//   A un archivo que aún no tiene (subido antes del cambio) se le hace aquí, una sola vez y de uno en
//   uno, con el archivo servido por el mismo origen (/api/biblioteca/{id}/original).
import { useEffect, useState } from "react";
import { getMultimediaAssets, saveMediaThumbnailAction } from "@/lib/actions/media-library";
import { makeThumbnail } from "@/lib/media-library/make-thumbnail";
import type { MediaAssetView } from "@/lib/media-library/service";

let cache: MediaAssetView[] | null = null;
let inflight: Promise<MediaAssetView[]> | null = null;
const listeners = new Set<(assets: MediaAssetView[]) => void>();
// Archivos cuya miniatura ya se intentó en esta página (bien o mal): no se repite en bucle.
const attempted = new Set<string>();
let backfilling = false;

function publish(next: MediaAssetView[]) {
  cache = next;
  for (const listener of listeners) listener(next);
}

async function backfillThumbnails() {
  if (backfilling) return;
  backfilling = true;
  try {
    for (;;) {
      const next = cache?.find((a) => !a.thumbUrl && a.kind !== "document" && !attempted.has(a.id));
      if (!next || next.kind === "document") return;
      attempted.add(next.id);
      const res = await fetch(`/api/biblioteca/${encodeURIComponent(next.id)}/original`).catch(() => null);
      if (!res?.ok) continue;
      const thumb = await makeThumbnail(await res.blob(), next.kind);
      if (!thumb) continue;
      const saved = await saveMediaThumbnailAction({ assetId: next.id, jpegBase64: thumb }).catch(() => ({ ok: false }));
      if (!saved.ok || !cache) continue;
      publish(cache.map((a) => (a.id === next.id ? { ...a, thumbUrl: `data:image/jpeg;base64,${thumb}` } : a)));
    }
  } finally {
    backfilling = false;
  }
}

/** Pide (o vuelve a pedir) la lista; una sola petición a la vez. */
export function prefetchMultimedia(): Promise<MediaAssetView[]> {
  inflight ??= getMultimediaAssets()
    .then((list) => {
      // Una miniatura que se hizo en esta página y la lista aún no trae: se conserva.
      const known = new Map((cache ?? []).map((a) => [a.id, a.thumbUrl]));
      publish(list.map((a) => (a.thumbUrl ? a : { ...a, thumbUrl: known.get(a.id) ?? null })));
      void backfillThumbnails();
      return cache ?? list;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Lista para Multimedia: la guardada al instante y la fresca en cuanto llega. */
export function useMultimediaAssets(): { assets: MediaAssetView[] | null; error: string | null } {
  const [assets, setAssets] = useState<MediaAssetView[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listeners.add(setAssets);
    prefetchMultimedia().catch(() => {
      if (!cache) setError("No se pudo abrir la Biblioteca.");
    });
    return () => {
      listeners.delete(setAssets);
    };
  }, []);
  return { assets, error };
}
