// Teléfono escrito a mano en "Nuevo contacto" (28-sep-2026) → E.164. Puro.
// El vendedor escribe como lo tiene: "668 123 4567", "(668) 123-45-67",
// "+52 668 123 4567", "52 668…" o un número de otro país con "+". Diez dígitos
// sin lada de país = México (+52). Lo demás lo valida normalizePhone.
import { normalizePhone } from "@/lib/phone";

export function phoneFromForm(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("El teléfono es obligatorio para poder escribirle por WhatsApp.");
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) return normalizePhone(trimmed);
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return normalizePhone(`+52${digits}`);
  if ((digits.length === 12 && digits.startsWith("52")) || (digits.length === 13 && digits.startsWith("521"))) {
    return normalizePhone(`+${digits}`);
  }
  throw new Error("Teléfono no válido: escribe los 10 dígitos (ej. 668 123 4567) o, si es de otro país, empieza con + y la lada.");
}
