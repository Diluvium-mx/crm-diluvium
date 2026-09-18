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

// México: desde 2019 los celulares se marcan sin el "1" tras el +52, pero
// WhatsApp todavía identifica muchos números como 521XXXXXXXXXX. El mismo
// cliente puede llegar como +521… (webhook) y estar guardado como +52…
// (importación de GHL), o al revés. Para BUSCAR un contacto se prueban ambas
// formas; para GUARDAR uno nuevo se usa la canónica (+52 + 10 dígitos).
const MX_WITH_ONE = /^\+521(\d{10})$/;
const MX_CANONICAL = /^\+52(\d{10})$/;

export function canonicalPhone(e164: string): string {
  const legacy = e164.match(MX_WITH_ONE);
  return legacy ? `+52${legacy[1]}` : e164;
}

export function phoneLookupVariants(e164: string): string[] {
  const canonical = canonicalPhone(e164);
  const mx = canonical.match(MX_CANONICAL);
  return mx ? [canonical, `+521${mx[1]}`] : [canonical];
}
