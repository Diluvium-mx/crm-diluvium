"use client";

// «✎ Editar contacto» del Detalle (12-oct-2026): nombre, apellido y correo, con el mismo
// formato que «＋ Nuevo contacto». El teléfono no se edita (decisión del dueño): se captura solo
// al crear el contacto, y el de WhatsApp lo da el cliente al escribir. Al guardar, el aviso en vivo
// (`datos`) pone el nombre al día en el Embudo, la Bandeja y el Detalle.
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { editContactBasics } from "@/lib/actions/contacts";
import type { ContactBasics } from "@/lib/contacts/edit-basics";

const INPUT_CLASS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";

export function EditContactDialog({
  contactId,
  initial,
  onClose,
  onSaved,
}: {
  contactId: string;
  initial: ContactBasics;
  onClose: () => void;
  onSaved: (saved: ContactBasics) => void;
}) {
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !firstName.trim()) return;
    setBusy(true);
    setError(null);
    const result = await editContactBasics(contactId, { firstName, lastName, email }).catch(() => null);
    setBusy(false);
    if (!result) {
      setError("No se pudo guardar. Revisa tu conexión y vuelve a intentarlo.");
      return;
    }
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved({ firstName: result.firstName, lastName: result.lastName, email: result.email });
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="gap-4 sm:max-w-md">
        <div className="space-y-1">
          <DialogTitle className="text-base font-semibold">Editar contacto</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            El teléfono no se cambia: es el número con el que el cliente escribe.
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
              <label htmlFor="ec-first" className="text-xs font-medium text-muted-foreground">Nombre *</label>
              <input id="ec-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus className={INPUT_CLASS} />
            </div>
            <div className="space-y-1">
              <label htmlFor="ec-last" className="text-xs font-medium text-muted-foreground">Apellido</label>
              <input id="ec-last" value={lastName} onChange={(e) => setLastName(e.target.value)} className={INPUT_CLASS} />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="ec-email" className="text-xs font-medium text-muted-foreground">Correo</label>
            <input id="ec-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS} />
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
              ⚠ {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || !firstName.trim()}
              className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-orange-light disabled:opacity-50"
            >
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
