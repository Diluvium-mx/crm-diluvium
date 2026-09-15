import { STAGES, type Contact, type Stage } from "../_data/types";

export function ContactDetailPanel({
  contact,
  onClose,
  onStageChange,
}: {
  contact: Contact;
  onClose: () => void;
  onStageChange: (stage: Stage) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Cerrar panel de detalle"
        onClick={onClose}
        className="flex-1 bg-black/30"
      />

      <aside className="flex h-full w-full max-w-sm flex-col gap-5 bg-background p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">{contact.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            Cerrar
          </button>
        </div>

        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Teléfono</dt>
            <dd>{contact.phone}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Correo</dt>
            <dd>{contact.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Empresa</dt>
            <dd>{contact.company}</dd>
          </div>
        </dl>

        <div className="space-y-1">
          <label htmlFor="contact-stage" className="text-xs text-muted-foreground">
            Etapa
          </label>
          <select
            id="contact-stage"
            value={contact.stage}
            onChange={(event) => onStageChange(event.target.value as Stage)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </div>
      </aside>
    </div>
  );
}
