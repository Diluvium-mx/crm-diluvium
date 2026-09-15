import type { Contact } from "../_data/types";

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

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
      <span className="font-medium">{contact.name}</span>
      <span className="text-muted-foreground">{contact.phone}</span>
      <span className="text-xs text-muted-foreground">
        {contact.stage} · {formatCurrency(contact.valueCents)}
      </span>
    </button>
  );
}
