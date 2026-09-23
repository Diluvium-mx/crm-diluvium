"use client";

// Biblioteca de media (Fase D): imágenes, videos y documentos que usan los
// workflows. El archivo sube en streaming a /api/biblioteca/upload (bucket
// privado); la vista previa pasa por /api/biblioteca/{id} (URL firmada).
import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { deleteMediaAssetAction, renameMediaAssetAction } from "@/lib/actions/media-library";
import type { MediaAssetView } from "@/lib/media-library/service";
import { MEDIA_LIMITS, validateUpload } from "@/lib/media-library/rules";
import { formatBytes } from "./labels";

export async function uploadAsset(file: File, title: string): Promise<{ ok: true; asset: MediaAssetView } | { ok: false; error: string }> {
  try {
    validateUpload({ fileName: file.name, mimeType: file.type, bytes: file.size });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Archivo inválido." };
  }
  const res = await fetch("/api/biblioteca/upload", {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-File-Name": encodeURIComponent(file.name),
      "X-Title": encodeURIComponent(title || file.name),
      "X-File-Size": String(file.size),
    },
    body: file,
  });
  const json = (await res.json().catch(() => null)) as { asset?: MediaAssetView; error?: string } | null;
  if (!res.ok || !json?.asset) return { ok: false, error: json?.error ?? `No se pudo subir (${res.status}).` };
  return { ok: true, asset: json.asset };
}

export function AssetPreview({ asset, className = "" }: { asset: MediaAssetView; className?: string }) {
  const src = `/api/biblioteca/${asset.id}`;
  // <img> a propósito: la ruta redirige a una URL firmada del bucket privado;
  // next/image no puede optimizar (ni cachear) un recurso privado y temporal.
  // eslint-disable-next-line @next/next/no-img-element
  if (asset.kind === "image") return <img src={src} alt={asset.title} className={`object-cover ${className}`} />;
  if (asset.kind === "video") return <video src={src} controls preload="metadata" className={`bg-black ${className}`} />;
  return (
    <div className={`flex items-center justify-center bg-muted text-3xl ${className}`} aria-label="Documento">
      📄
    </div>
  );
}

export function BibliotecaTab({
  assets,
  onChanged,
}: {
  assets: MediaAssetView[];
  onChanged: (next: MediaAssetView[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    const added: MediaAssetView[] = [];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const r = await uploadAsset(file, "");
      if (r.ok) added.push(r.asset);
      else errors.push(`${file.name}: ${r.error}`);
    }
    if (added.length) onChanged([...added, ...assets]);
    if (errors.length) setError(errors.join(" · "));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function rename(asset: MediaAssetView) {
    const title = window.prompt("Nuevo nombre del archivo:", asset.title);
    if (title === null || title.trim() === asset.title) return;
    const r = await renameMediaAssetAction({ assetId: asset.id, title });
    if (!r.ok) return setError(r.error);
    onChanged(assets.map((a) => (a.id === asset.id ? { ...a, title: title.trim() } : a)));
  }

  async function remove(asset: MediaAssetView) {
    if (!window.confirm(`¿Borrar "${asset.title}" de la biblioteca?`)) return;
    const r = await deleteMediaAssetAction({ assetId: asset.id });
    if (!r.ok) return setError(r.error);
    onChanged(assets.filter((a) => a.id !== asset.id));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Imagen {MEDIA_LIMITS.image.label} · Video {MEDIA_LIMITS.video.label} · Documento PDF hasta 100 MB. Son los límites de WhatsApp.
        </p>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-brand-white hover:bg-brand-orange-light">
          <Upload className="size-4" aria-hidden="true" /> {busy ? "Subiendo…" : "Subir archivos"}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,video/mp4,video/3gpp,application/pdf"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
      </div>
      {error && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
      {assets.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Todavía no hay archivos. Sube la tabla de tamaños, los datos bancarios y los videos de instalación.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((a) => (
            <li key={a.id} className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <AssetPreview asset={a} className="h-36 w-full" />
              <div className="space-y-1 p-2">
                <button type="button" onClick={() => void rename(a)} className="block w-full truncate text-left text-sm font-medium hover:underline" title="Renombrar">
                  {a.title}
                </button>
                <p className="truncate text-[11px] text-muted-foreground">
                  {a.kind === "image" ? "Imagen" : a.kind === "video" ? "Video" : "Documento"} · {formatBytes(a.bytes)} · {a.fileName}
                </p>
                <div className="flex justify-end">
                  <button type="button" onClick={() => void remove(a)} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label={`Borrar ${a.title}`}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
