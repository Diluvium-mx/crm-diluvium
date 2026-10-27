"use client";

// Ventana «Borrar contacto» (derechos ARCO, 7-oct-2026): dice QUÉ se borra (chats, mensajes,
// archivos, Detalle, seguimientos y programados pendientes) y pide escribir BORRAR. Si la base se
// borró pero quedaron archivos en el almacenamiento, lo dice con cuántos y deja «Reintentar»: el
// error nunca se esconde. El marco (portal encima de todo, Esc, foco) es ArcoDialog, el mismo de
// «Exportar datos». Sin lógica de datos: llama a las acciones de lib/actions/contact-arco.ts.
import { useEffect, useId, useState } from "react";
import { deleteContact, getContactArcoSummary, retryContactFilesDeletion } from "@/lib/actions/contact-arco";
import type { ContactArcoSummary } from "@/lib/contacts/arco/summary";
import { ArcoDialog } from "./arco-dialog";
import { finishDeleting, startDeleting } from "./deleting-contacts";

type Phase =
  | { kind: "loading" }
  | { kind: "confirm"; summary: ContactArcoSummary }
  | { kind: "load-error"; message: string }
  | { kind: "pending-files"; count: number; token: string };

const n = (value: number, one: string, many: string) => `${value.toLocaleString("es-MX")} ${value === 1 ? one : many}`;

/** Renglones de «Se borra para siempre…» con las cuentas del contacto. */
export function deletionLines(s: ContactArcoSummary): string[] {
  return [
    s.chats === 0 ? "Sin chats" : `${n(s.chats, "chat", "chats")} con ${n(s.mensajes, "mensaje", "mensajes")}`,
    s.archivos === 0 ? "Ningún archivo del chat" : `${n(s.archivos, "archivo", "archivos")} del chat (fotos, audios, videos y documentos)`,
    "Su Detalle (calificación, entradas, monto y pago)",
    s.seguimientos === 0 ? "Sin seguimientos del Agente IA pendientes" : `${n(s.seguimientos, "seguimiento del Agente IA pendiente", "seguimientos del Agente IA pendientes")}`,
    s.programados === 0 ? "Sin mensajes programados" : `${n(s.programados, "mensaje programado", "mensajes programados")}`,
  ];
}

export function DeleteContactDialog({
  contactId,
  contactName,
  onClose,
  onDeleted,
}: {
  contactId: string;
  contactName: string;
  /** Cerrar sin borrar. */
  onClose: () => void;
  /** Ya se borró: el tablero lo quita (y cierra su Detalle). */
  onDeleted: () => void;
}) {
  const inputId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getContactArcoSummary(contactId)
      .then((result) => {
        if (!alive) return;
        setPhase(result.ok ? { kind: "confirm", summary: result.summary } : { kind: "load-error", message: result.message });
      })
      .catch(() => {
        if (alive) setPhase({ kind: "load-error", message: "No se pudo revisar el contacto. Revisa tu conexión." });
      });
    return () => {
      alive = false;
    };
  }, [contactId]);

  // Cerrar: en «quedaron archivos» el contacto YA se borró (el tablero lo quita al cerrar).
  function close() {
    if (busy) return;
    if (phase.kind === "pending-files") onDeleted();
    else onClose();
  }

  const confirmed = typed.trim().toUpperCase() === "BORRAR";

  async function confirm() {
    if (busy || !confirmed || phase.kind !== "confirm") return;
    setBusy(true);
    setError(null);
    startDeleting(contactId);
    try {
      const result = await deleteContact({ contactId, confirmacion: typed });
      const arrived = finishDeleting(contactId);
      setBusy(false);
      if (!result.ok) {
        // Pudo haberlo borrado otra persona justo antes: si llegó el aviso, igual se quita.
        if (arrived) onDeleted();
        else setError(result.message);
        return;
      }
      if (result.pendingFiles === 0 || !result.retryToken) {
        onDeleted();
        return;
      }
      setPhase({ kind: "pending-files", count: result.pendingFiles, token: result.retryToken });
    } catch {
      const arrived = finishDeleting(contactId);
      setBusy(false);
      // Sin respuesta (red o versión vieja): si el aviso en vivo dijo que se borró, se quita.
      if (arrived) onDeleted();
      else setError("No se pudo confirmar el borrado. Revisa tu conexión y vuelve a intentarlo.");
    }
  }

  async function retry() {
    if (busy || phase.kind !== "pending-files") return;
    setBusy(true);
    setError(null);
    try {
      const result = await retryContactFilesDeletion(phase.token);
      setBusy(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.pendingFiles === 0 || !result.retryToken) {
        onDeleted();
        return;
      }
      setPhase({ kind: "pending-files", count: result.pendingFiles, token: result.retryToken });
      setError(`${result.pendingFiles === 1 ? "Sigue quedando 1 archivo" : `Siguen quedando ${n(result.pendingFiles, "archivo", "archivos")}`}. Vuelve a intentarlo en unos minutos.`);
    } catch {
      setBusy(false);
      setError("No se pudo reintentar. Revisa tu conexión.");
    }
  }

  return (
    <ArcoDialog
      title={phase.kind === "pending-files" ? "Contacto borrado" : `¿Borrar a «${contactName}»?`}
      onClose={close}
      footer={
        <>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {phase.kind === "pending-files" ? "Cerrar" : "Cancelar"}
          </button>
          {phase.kind === "confirm" && (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || !confirmed}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Borrando…" : "Borrar contacto"}
            </button>
          )}
          {phase.kind === "pending-files" && (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={busy}
              className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-orange-light disabled:opacity-50"
            >
              {busy ? "Reintentando…" : "Reintentar"}
            </button>
          )}
        </>
      }
    >
      {phase.kind === "loading" && <p className="text-muted-foreground">Revisando qué se borra…</p>}

      {phase.kind === "load-error" && (
        <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
          ⚠ {phase.message}
        </p>
      )}

      {phase.kind === "confirm" && (
        <>
          <div className="space-y-1.5">
            <p>Se borra para siempre del CRM, para todo el equipo:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {deletionLines(phase.summary).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              No se puede deshacer. Si el cliente vuelve a escribir, entra como contacto nuevo. Los archivos de la
              Biblioteca que se le mandaron no se tocan. En Agente IA › Historial queda quién lo borró y cuándo, sin su
              nombre ni su teléfono.
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
              Escribe <span className="font-semibold text-foreground">BORRAR</span> para confirmar
            </label>
            <input
              id={inputId}
              value={typed}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirm();
                }
              }}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-600/30"
            />
          </div>
        </>
      )}

      {phase.kind === "pending-files" && (
        <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
          ⚠ Se borró el contacto, pero {phase.count === 1 ? "quedó 1 archivo" : `quedaron ${n(phase.count, "archivo", "archivos")}`} en el
          almacenamiento sin poderse borrar. Reintenta ahora o en unos minutos.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
          ⚠ {error}
        </p>
      )}
    </ArcoDialog>
  );
}
