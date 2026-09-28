"use client";

// "＋ Nuevo contacto" del Embudo (28-sep-2026), como la pestaña Contactos de GHL
// pero con menos datos: nombre, apellido, teléfono, correo y etapa (la zona
// horaria sale de la lada). Al crearlo se abre su pop-up, donde se le escribe
// primero (WhatsApp Web gratis o plantilla). Si el teléfono ya existe, se ofrece
// abrir ese contacto en vez de duplicarlo.
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createContact } from "@/lib/actions/contacts";
import type { FunnelStage } from "@/lib/contacts/stages";
import type { BoardContact } from "../_data/types";

const INPUT_CLASS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";

export function NewContactDialog({
  open,
  stages,
  onClose,
  onCreated,
  onOpenExisting,
}: {
  open: boolean;
  stages: FunnelStage[];
  onClose: () => void;
  onCreated: (contact: BoardContact) => void;
  onOpenExisting: (contactId: string) => void;
}) {
  const entry = stages.find((s) => s.role === "entrada")?.key ?? stages[0]?.key ?? "";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState(entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  function reset() {
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setStage(entry);
    setError(null);
    setDuplicate(null);
  }

  async function submit() {
    if (busy || !firstName.trim() || !phone.trim()) return;
    setBusy(true);
    setError(null);
    setDuplicate(null);
    const result = await createContact({
      firstName,
      lastName,
      phone,
      email: email.trim(),
      stage: stage || undefined,
    }).catch(() => null);
    setBusy(false);
    if (!result) {
      setError("No se pudo crear. Revisa tu conexión y vuelve a intentarlo.");
      return;
    }
    if (!result.ok) {
      setError(result.message);
      setDuplicate(result.duplicate ?? null);
      return;
    }
    reset();
    onCreated(result.contact);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="gap-4 sm:max-w-md">
        <div className="space-y-1">
          <DialogTitle className="text-base font-semibold">Nuevo contacto</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Al crearlo se abre su chat para escribirle primero: gratis desde WhatsApp Web o con una plantilla.
          </DialogDescription>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="nc-first" className="text-xs font-medium text-muted-foreground">Nombre *</label>
              <input id="nc-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus className={INPUT_CLASS} />
            </div>
            <div className="space-y-1">
              <label htmlFor="nc-last" className="text-xs font-medium text-muted-foreground">Apellido</label>
              <input id="nc-last" value={lastName} onChange={(e) => setLastName(e.target.value)} className={INPUT_CLASS} />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="nc-phone" className="text-xs font-medium text-muted-foreground">Teléfono (WhatsApp) *</label>
            <input
              id="nc-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="668 123 4567"
              className={INPUT_CLASS}
            />
            <p className="text-[11px] text-muted-foreground">10 dígitos si es de México; de otro país, empieza con + y la lada.</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="nc-email" className="text-xs font-medium text-muted-foreground">Correo</label>
            <input id="nc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div className="space-y-1">
            <label htmlFor="nc-stage" className="text-xs font-medium text-muted-foreground">Etapa</label>
            <select id="nc-stage" value={stage} onChange={(e) => setStage(e.target.value)} className={INPUT_CLASS}>
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
              <span>⚠ {error}</span>
              {duplicate && (
                <button
                  type="button"
                  onClick={() => {
                    const id = duplicate.id;
                    reset();
                    onOpenExisting(id);
                  }}
                  className="font-semibold text-brand-navy underline dark:text-sky-300"
                >
                  Abrir «{duplicate.name}»
                </button>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              disabled={busy}
              className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || !firstName.trim() || !phone.trim()}
              className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-orange-light disabled:opacity-50"
            >
              {busy ? "Creando…" : "Crear contacto"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
