"use client";

// Biblioteca de media (Fase D): imágenes, videos y documentos que usan los
// workflows. El archivo sube en streaming a /api/biblioteca/upload (bucket
// privado); la vista previa pasa por /api/biblioteca/{id} (URL firmada).
// Desde el 3-oct-2026 los archivos también se pueden arrastrar desde la
// computadora y soltar en cualquier parte de la pestaña (la misma capa del chat).
import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { TopConfirm } from "@/components/ui/top-confirm";
import { deleteMediaAssetAction, renameMediaAssetAction, saveMediaThumbnailAction } from "@/lib/actions/media-library";
import { makeThumbnail } from "@/lib/media-library/make-thumbnail";
import type { MediaAssetView } from "@/lib/media-library/service";
import { MEDIA_LIMITS, validateUpload } from "@/lib/media-library/rules";
import { formatBytes } from "./labels";

// Lo que ofrece el botón «Subir archivos». Arrastrar se salta el filtro del selector, así
// que lo soltado se revisa contra esta misma lista (el servidor acepta además Word/Excel).
const PICKER_TYPES = ["image/png", "image/jpeg", "video/mp4", "video/3gpp", "application/pdf"];

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
  const asset = json.asset;
  // Miniatura para Multimedia (30-sep-2026), sola y con el archivo que ya está en el equipo: no se
  // descarga nada. Si falla, la hace Multimedia la primera vez que se abra.
  if (asset.kind !== "document") {
    const thumb = await makeThumbnail(file, asset.kind);
    if (thumb && (await saveMediaThumbnailAction({ assetId: asset.id, jpegBase64: thumb }).catch(() => ({ ok: false }))).ok) {
      return { ok: true, asset: { ...asset, thumbUrl: `data:image/jpeg;base64,${thumb}` } };
    }
  }
  return { ok: true, asset };
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
  // Borrar un archivo pide confirmar (no se puede deshacer), con el aviso del CRM.
  const [deleting, setDeleting] = useState<MediaAssetView | null>(null);
  const [removing, setRemoving] = useState(false);
  // Renombrar también con el aviso del CRM (29-sep-2026; antes la ventana gris del navegador),
  // con el campo del nombre adentro.
  const [renaming, setRenaming] = useState<{ asset: MediaAssetView; title: string } | null>(null);
  const [savingName, setSavingName] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: File[]) {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const added: MediaAssetView[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (!PICKER_TYPES.includes(file.type)) {
        errors.push(`${file.name}: tipo de archivo no permitido. Imagen JPEG/PNG, video MP4 o documento PDF.`);
        continue;
      }
      const r = await uploadAsset(file, "");
      if (r.ok) added.push(r.asset);
      else errors.push(`${file.name}: ${r.error}`);
    }
    if (added.length) onChanged([...added, ...assets]);
    if (errors.length) setError(errors.join(" · "));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function rename(asset: MediaAssetView, raw: string) {
    const title = raw.trim();
    if (!title) return;
    if (title === asset.title) return setRenaming(null);
    setSavingName(true);
    const r = await renameMediaAssetAction({ assetId: asset.id, title });
    setSavingName(false);
    setRenaming(null);
    if (!r.ok) return setError(r.error);
    onChanged(assets.map((a) => (a.id === asset.id ? { ...a, title } : a)));
  }

  async function remove(asset: MediaAssetView) {
    setRemoving(true);
    const r = await deleteMediaAssetAction({ assetId: asset.id });
    setRemoving(false);
    setDeleting(null);
    if (!r.ok) return setError(r.error);
    onChanged(assets.filter((a) => a.id !== asset.id));
  }

  return (
    <FileDropZone
      enabled={!busy}
      onFiles={(files) => void onFiles(files)}
      onBrowse={() => fileRef.current?.click()}
      helpText={`Imagen ${MEDIA_LIMITS.image.label} · Video ${MEDIA_LIMITS.video.label} · Documento PDF hasta 100 MB.`}
      testId="capa-biblioteca"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
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
                accept={PICKER_TYPES.join(",")}
                className="sr-only"
                disabled={busy}
                onChange={(e) => void onFiles(Array.from(e.target.files ?? []))}
              />
            </label>
          </div>
          {error && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
          {assets.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Todavía no hay archivos. Sube la tabla de tamaños, los datos bancarios y los videos de instalación (con el botón o arrastrándolos aquí).
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {assets.map((a) => (
                <li key={a.id} className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  <AssetPreview asset={a} className="h-36 w-full" />
                  <div className="space-y-1 p-2">
                    <button type="button" onClick={() => setRenaming({ asset: a, title: a.title })} className="block w-full truncate text-left text-sm font-medium hover:underline" title="Renombrar">
                      {a.title}
                    </button>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {a.kind === "image" ? "Imagen" : a.kind === "video" ? "Video" : "Documento"} · {formatBytes(a.bytes)} · {a.fileName}
                    </p>
                    <div className="flex justify-end">
                      <button type="button" onClick={() => setDeleting(a)} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label={`Borrar ${a.title}`}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {renaming && (
            <TopConfirm
              title="Renombrar archivo"
              confirmLabel="Guardar"
              pendingLabel="Guardando…"
              pending={savingName}
              confirmDisabled={!renaming.title.trim()}
              focusCancel={false}
              onConfirm={() => void rename(renaming.asset, renaming.title)}
              onCancel={() => setRenaming(null)}
            >
              <label className="flex flex-col gap-1">
                <span>Nombre con el que lo encuentras en la biblioteca (el cliente no lo ve).</span>
                <input
                  autoFocus
                  value={renaming.title}
                  maxLength={120}
                  disabled={savingName}
                  onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renaming.title.trim()) {
                      e.preventDefault();
                      void rename(renaming.asset, renaming.title);
                    }
                  }}
                  aria-label="Nombre del archivo"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/30"
                />
              </label>
            </TopConfirm>
          )}
          {deleting && (
            <TopConfirm
              title={`¿Borrar «${deleting.title}» de la biblioteca?`}
              confirmLabel="Borrar"
              pendingLabel="Borrando…"
              pending={removing}
              onConfirm={() => void remove(deleting)}
              onCancel={() => setDeleting(null)}
            >
              No se puede borrar si algún paso de un workflow lo usa.
            </TopConfirm>
          )}
        </div>
      </div>
    </FileDropZone>
  );
}
