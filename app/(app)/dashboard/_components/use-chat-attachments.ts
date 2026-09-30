"use client";

// Estado de los adjuntos del composer (28-sep-2026), compartido por la capa de
// soltar, el 📎, pegar con Cmd+V y la vista previa. Cada archivo empieza a
// subir en cuanto entra (mientras el vendedor escribe): primero se revisa con
// las reglas de WhatsApp (lib/chat-attachments/rules.ts), una foto HEIC/WebP o
// de más de 5 MB se convierte a JPG en el navegador, y se sube por la ruta
// /api/inbox/adjuntos (XHR: da el avance de la subida). Al cambiar de
// conversación se cancela y se olvida todo.
// Multimedia (30-sep-2026): las fotos y videos de la Biblioteca entran a la
// misma vista previa YA listos: no se suben, ya están en el bucket.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertToWhatsappJpeg } from "@/lib/chat-attachments/convert";
import { CHAT_MAX_FILES, planFile, type ChatFileKind } from "@/lib/chat-attachments/rules";
import type { MediaAssetView } from "@/lib/media-library/service";

export type AttachmentItem = {
  id: string;
  name: string;
  size: number;
  kind: ChatFileKind;
  /** URL local (object URL) para la miniatura de foto o video. */
  previewUrl: string | null;
  state: "converting" | "uploading" | "ready" | "error";
  /** 0..1 */
  progress: number;
  token?: string;
  error?: string;
  /** Archivo de la Biblioteca (Multimedia): se manda por su id, sin subirlo. */
  assetId?: string;
};

export type ChatAttachments = {
  items: AttachmentItem[];
  notices: string[];
  addFiles: (files: readonly File[]) => void;
  /** Multimedia: agrega el archivo de la Biblioteca o, si ya está, lo quita. */
  toggleLibrary: (asset: MediaAssetView) => void;
  remove: (id: string) => void;
  clear: () => void;
  dismissNotices: () => void;
  /** Hay archivos y todos terminaron de subir sin error. */
  allReady: boolean;
  /**
   * Id de ESTE envío (uno por vista previa; cambia al vaciarla o al cambiar de
   * conversación). Repetir el envío tras un error no duplica los de la Biblioteca.
   */
  sendId: () => string;
};

function newSendId(): string {
  // randomUUID solo existe en https/localhost; el respaldo basta para no repetir.
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

type UploadResponse = { token: string; fileName: string; kind: ChatFileKind; mime: string; bytes: number } | { error?: string };

function upload(file: File, conversationId: string, onProgress: (p: number) => void, register: (xhr: XMLHttpRequest) => void): Promise<UploadResponse & { status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open("POST", "/api/inbox/adjuntos");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-Conversation-Id", conversationId);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: UploadResponse = {};
      try {
        body = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        // respuesta sin JSON (proxy, corte): se trata abajo por el estado
      }
      resolve({ ...body, status: xhr.status });
    };
    xhr.onerror = () => reject(new Error("Se cortó la conexión al subir."));
    xhr.onabort = () => reject(new DOMException("cancelado", "AbortError"));
    xhr.send(file);
  });
}

export function useChatAttachments(conversationId: string): ChatAttachments {
  // Estado ligado a la conversación: al cambiar, lo anterior deja de verse sin setState en un efecto.
  const [state, setState] = useState<{ conversationId: string; items: AttachmentItem[]; notices: string[] }>({
    conversationId,
    items: [],
    notices: [],
  });
  const current = state.conversationId === conversationId ? state : { conversationId, items: [], notices: [] };
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const urls = useRef(new Map<string, string>());
  // Archivos que siguen en la vista previa (uno quitado a media conversión no se sube).
  const live = useRef(new Set<string>());
  // Cupo real (no el del último render): soltar y pegar muy seguido no pasa de 10.
  const countRef = useRef(0);
  // Archivo de la Biblioteca → su renglón en la vista previa (no se agrega dos veces).
  const library = useRef(new Map<string, string>());
  const sendIdRef = useRef<string | null>(null);
  const convRef = useRef(conversationId);
  useEffect(() => {
    convRef.current = conversationId;
  }, [conversationId]);

  const patch = useCallback(
    (fn: (s: { items: AttachmentItem[]; notices: string[] }) => { items: AttachmentItem[]; notices: string[] }) =>
      setState((prev) => {
        const base = prev.conversationId === convRef.current ? prev : { conversationId: convRef.current, items: [], notices: [] };
        return { conversationId: convRef.current, ...fn(base) };
      }),
    [],
  );
  const update = useCallback(
    (id: string, changes: Partial<AttachmentItem>) => patch((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...changes } : it)) })),
    [patch],
  );

  const release = useCallback((id: string) => {
    if (live.current.delete(id)) countRef.current = Math.max(0, countRef.current - 1);
    for (const [assetId, itemId] of library.current) if (itemId === id) library.current.delete(assetId);
    xhrs.current.get(id)?.abort();
    xhrs.current.delete(id);
    const url = urls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.current.delete(id);
  }, []);
  const releaseAll = useCallback(() => {
    for (const id of [...live.current, ...xhrs.current.keys(), ...urls.current.keys()]) release(id);
    sendIdRef.current = null;
  }, [release]);

  // Cambio de conversación o salir del chat: se cancelan las subidas y se sueltan las miniaturas.
  useEffect(() => releaseAll, [conversationId, releaseAll]);

  const process = useCallback(
    async (id: string, original: File, convert: boolean, forConversation: string) => {
      let file = original;
      try {
        if (convert) {
          file = await convertToWhatsappJpeg(original);
          if (!live.current.has(id)) return;
          const url = URL.createObjectURL(file);
          const old = urls.current.get(id);
          if (old) URL.revokeObjectURL(old);
          urls.current.set(id, url);
          update(id, { name: file.name, size: file.size, previewUrl: url, state: "uploading" });
        }
        // Se cambió de conversación (o se quitó) mientras se convertía: no se sube.
        if (convRef.current !== forConversation || !live.current.has(id)) return;
        const res = await upload(file, forConversation, (p) => update(id, { progress: p }), (xhr) => xhrs.current.set(id, xhr));
        xhrs.current.delete(id);
        if (res.status === 201 && "token" in res && res.token) {
          update(id, { state: "ready", progress: 1, token: res.token, name: res.fileName, size: res.bytes });
        } else {
          const message = "error" in res && res.error ? res.error : res.status === 413 ? "El archivo es demasiado grande." : "No se pudo subir. Quítalo y vuelve a adjuntarlo.";
          update(id, { state: "error", error: message });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        update(id, { state: "error", error: error instanceof Error ? error.message : "No se pudo subir." });
      }
    },
    [update],
  );

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const room = CHAT_MAX_FILES - countRef.current;
      const notices: string[] = [];
      const accepted: { item: AttachmentItem; file: File; convert: boolean }[] = [];
      let overflow = 0;
      for (const file of files) {
        const plan = planFile(file);
        if (!plan.ok) {
          notices.push(plan.message);
          continue;
        }
        if (accepted.length >= room) {
          overflow++;
          continue;
        }
        const id = `adj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        // HEIC no se puede mostrar en Chrome: su miniatura sale después de convertirla.
        const canPreview = plan.kind === "video" || (plan.kind === "image" && /\.(jpe?g|png|webp)$/i.test(file.name));
        const previewUrl = canPreview ? URL.createObjectURL(file) : null;
        if (previewUrl) urls.current.set(id, previewUrl);
        live.current.add(id);
        countRef.current += 1;
        const convert = plan.action === "convert";
        accepted.push({
          item: { id, name: file.name, size: file.size, kind: plan.kind, previewUrl, state: convert ? "converting" : "uploading", progress: 0 },
          file,
          convert,
        });
      }
      if (overflow) notices.push(`Máximo ${CHAT_MAX_FILES} archivos por envío: ${overflow === 1 ? "1 no se agregó" : `${overflow} no se agregaron`}.`);
      patch((s) => ({ items: [...s.items, ...accepted.map((a) => a.item)], notices: [...s.notices, ...notices] }));
      for (const a of accepted) void process(a.item.id, a.file, a.convert, conversationId);
    },
    [conversationId, patch, process],
  );

  const toggleLibrary = useCallback(
    (asset: MediaAssetView) => {
      const existing = library.current.get(asset.id);
      if (existing) {
        release(existing);
        patch((s) => ({ ...s, items: s.items.filter((it) => it.id !== existing) }));
        return;
      }
      if (asset.kind === "document") return;
      if (countRef.current >= CHAT_MAX_FILES) {
        patch((s) => ({ ...s, notices: [...s.notices, `Máximo ${CHAT_MAX_FILES} archivos por envío.`] }));
        return;
      }
      const id = `bib-${asset.id}-${Date.now()}`;
      live.current.add(id);
      countRef.current += 1;
      library.current.set(asset.id, id);
      const item: AttachmentItem = {
        id,
        name: asset.title,
        size: asset.bytes,
        kind: asset.kind,
        // La miniatura sale de la misma Biblioteca (redirige a una URL firmada).
        previewUrl: `/api/biblioteca/${asset.id}`,
        state: "ready",
        progress: 1,
        assetId: asset.id,
      };
      patch((s) => ({ ...s, items: [...s.items, item] }));
    },
    [patch, release],
  );

  const remove = useCallback(
    (id: string) => {
      release(id);
      patch((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }));
    },
    [patch, release],
  );
  const clear = useCallback(() => {
    releaseAll();
    patch(() => ({ items: [], notices: [] }));
  }, [patch, releaseAll]);
  const dismissNotices = useCallback(() => patch((s) => ({ ...s, notices: [] })), [patch]);
  const sendId = useCallback(() => (sendIdRef.current ??= newSendId()), []);

  const allReady = current.items.length > 0 && current.items.every((it) => it.state === "ready");
  return useMemo(
    () => ({ items: current.items, notices: current.notices, addFiles, toggleLibrary, remove, clear, dismissNotices, allReady, sendId }),
    [current.items, current.notices, addFiles, toggleLibrary, remove, clear, dismissNotices, allReady, sendId],
  );
}
