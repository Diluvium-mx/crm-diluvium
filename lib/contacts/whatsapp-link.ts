// Enlaces para escribirle a un contacto DESDE WhatsApp (no desde el CRM) con el
// texto ya puesto (28-sep-2026). Con coexistencia, lo que se manda desde WhatsApp
// Web o la app del celular es gratis y no tiene ventana de 24 h; su copia llega
// al CRM sola y crea el chat. Puro.
// - WhatsApp Web (computadora): web.whatsapp.com/send abre el chat directo.
// - Celular: wa.me, el enlace oficial de "clic para chatear" (faq.whatsapp.com).

function digits(phoneE164: string): string {
  return phoneE164.replace(/\D/g, "");
}

export function whatsappWebLink(phoneE164: string, text = ""): string {
  const params = new URLSearchParams({ phone: digits(phoneE164) });
  if (text.trim()) params.set("text", text.trim());
  return `https://web.whatsapp.com/send?${params.toString()}`;
}

export function whatsappPhoneLink(phoneE164: string, text = ""): string {
  const base = `https://wa.me/${digits(phoneE164)}`;
  return text.trim() ? `${base}?text=${encodeURIComponent(text.trim())}` : base;
}
