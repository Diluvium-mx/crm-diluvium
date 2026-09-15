import type { Contact } from "../_data/types";
import { STAGE_LABELS, getContactFullName } from "../_data/types";

export function ContactCard({
  contact,
  onClick,
}: {
  contact: Contact;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-1 rounded-md border bg-background p-3 text-left text-sm shadow-sm transition-colors hover:border-brand-navy"
    >
      <span className="font-medium">{getContactFullName(contact)}</span>
      <span className="text-muted-foreground">{contact.phoneE164 ?? "Sin teléfono"}</span>
      <span className="text-xs text-muted-foreground">{STAGE_LABELS[contact.stage]}</span>
    </button>
  );
}
