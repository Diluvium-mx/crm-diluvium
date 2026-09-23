"use client";

// Comentarios del contacto (A7/B2; reemplazan a las "Notas"). Autor obligatorio
// y fecha; editar/borrar solo el autor u owner/admin (el servidor lo exige).
import { useRef, useState } from "react";
import { addComment, deleteComment, updateComment } from "@/lib/actions/contact-qualification";

export type Comment = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date | null;
  author: { id: string; name: string };
};

const whenFormat = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mazatlan",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function ContactComments({
  contactId,
  comments,
  viewer,
  onChanged,
  run,
}: {
  contactId: string;
  comments: Comment[];
  viewer: { userId: string; canModerate: boolean };
  onChanged: () => Promise<void>;
  run: (action: () => Promise<unknown>, errorMessage?: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Esc cancela la edición: el blur que llega al desmontar no debe guardar.
  const cancelled = useRef(false);
  // Candado contra el doble Enter/clic con la red lenta (un solo comentario).
  const adding = useRef(false);

  async function add() {
    const body = draft.trim();
    if (!body || adding.current) return;
    adding.current = true;
    try {
      const ok = await run(() => addComment(contactId, body), "No se pudo agregar el comentario.");
      if (ok) {
        setDraft("");
        await onChanged();
      }
    } finally {
      adding.current = false;
    }
  }

  async function saveEdit(comment: Comment) {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const body = editText.trim();
    setEditingId(null);
    if (!body || body === comment.body) return;
    if (await run(() => updateComment(comment.id, body), "No se pudo editar el comentario.")) await onChanged();
  }

  async function remove(comment: Comment) {
    if (!window.confirm("¿Borrar este comentario?")) return;
    if (await run(() => deleteComment(comment.id), "No se pudo borrar el comentario.")) await onChanged();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Nuevo comentario"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void add();
            }
          }}
          rows={2}
          maxLength={5000}
          placeholder="Escribe un comentario… (Enter agrega)"
          className="min-w-0 flex-1 resize-y rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!draft.trim()}
          className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
        >
          Agregar
        </button>
      </div>
      {comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin comentarios.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => {
            const canModify = viewer.canModerate || c.author.id === viewer.userId;
            return (
              <li key={c.id} className="rounded-md bg-muted/50 px-2 py-1.5 text-sm">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{c.author.name}</span>
                  <span>{whenFormat.format(new Date(c.createdAt))}</span>
                  {c.updatedAt && <span>(editado)</span>}
                  {canModify && editingId !== c.id && (
                    <span className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          cancelled.current = false;
                          setEditingId(c.id);
                          setEditText(c.body);
                        }}
                        aria-label={`Editar comentario de ${c.author.name}`}
                        className="rounded px-1 hover:bg-muted hover:text-foreground"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(c)}
                        aria-label={`Borrar comentario de ${c.author.name}`}
                        className="rounded px-1 hover:bg-muted hover:text-brand-orange"
                      >
                        Borrar
                      </button>
                    </span>
                  )}
                </div>
                {editingId === c.id ? (
                  <textarea
                    aria-label="Editar comentario"
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => void saveEdit(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        cancelled.current = true;
                        setEditingId(null);
                      }
                    }}
                    rows={2}
                    maxLength={5000}
                    className="mt-1 w-full resize-y rounded-md border bg-background px-2 py-1 text-sm outline-none focus:border-brand-navy"
                  />
                ) : (
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
