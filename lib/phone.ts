// Normalización E.164 obligatoria antes de guardar un teléfono (CLAUDE.md §5).
// Función única, reusada en formularios, importación CSV y el webhook de WhatsApp.
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const withPlus = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  const candidate = withPlus.replace(/[\s()\-.]/g, "");

  if (!E164_PATTERN.test(candidate)) {
    throw new Error(
      `Teléfono inválido: "${raw}". Usa formato E.164 con código de país, ej. +525512345678.`,
    );
  }

  return candidate;
}
