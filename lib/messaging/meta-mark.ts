// Marca de Meta en los avisos de estado de WhatsApp (4-nov-2026, docs/meta-whatsapp.md). Zernio pasa lo que
// Meta manda en su webhook de estado: `pricing` {billable, pricingModel, category, type} y `billingConversation`
// {id, expiresAt, originType} (docs.zernio.com/webhooks/inbox). Meta los manda solo en `sent` y en uno de
// `delivered` o `read`; en los demás vienen null. PURO y tolerante: lo que no se reconoce se ignora y nunca
// tumba el estado.

export type MetaMark = {
  billable: boolean | null;
  // marketing · utility · service · authentication · referral_conversion… (minúsculas).
  category: string | null;
  // regular · free_entry_point · free_customer_service (minúsculas).
  pricingType: string | null;
  windowExpiresAt: Date | null;
  windowOrigin: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function word(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  return text && text.length <= 64 ? text : null;
}

function flag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

// Meta da la expiración en segundos (expiration_timestamp); Zernio la documenta como fecha. Se aceptan las dos
// y se descarta lo que no cae entre 2020 y 2100.
function moment(value: unknown): Date | null {
  let date: Date | null = null;
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()))) {
    const n = Number(value);
    date = new Date(n < 1e12 ? n * 1000 : n);
  } else if (typeof value === "string" && value.trim()) {
    date = new Date(value);
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year >= 2020 && year <= 2100 ? date : null;
}

/** Marca de Meta de un aviso de estado, o undefined si el aviso no la trae. */
export function parseMetaMark(payload: Record<string, unknown>): MetaMark | undefined {
  const message = record(payload.message) ?? {};
  const pricing = record(payload.pricing) ?? record(message.pricing);
  const window = record(payload.billingConversation) ?? record(message.billingConversation);
  if (!pricing && !window) return undefined;
  const mark: MetaMark = {
    billable: pricing ? flag(pricing.billable) : null,
    category: pricing ? word(pricing.category) : null,
    pricingType: pricing ? word(pricing.type) : null,
    windowExpiresAt: window ? moment(window.expiresAt ?? window.expirationTimestamp) : null,
    windowOrigin: window ? word(window.originType ?? record(window.origin)?.type) : null,
  };
  return Object.values(mark).some((v) => v !== null) ? mark : undefined;
}

/**
 * Columnas de `messages` que llena la marca. Solo lo que trae: un aviso con `pricing` y sin
 * `billingConversation` no borra la ventana que dejó el anterior.
 */
export function metaMarkColumns(mark: MetaMark) {
  return {
    ...(mark.billable !== null ? { metaBillable: mark.billable } : {}),
    ...(mark.category !== null ? { metaCategory: mark.category } : {}),
    ...(mark.pricingType !== null ? { metaPricingType: mark.pricingType } : {}),
    ...(mark.windowExpiresAt !== null ? { metaWindowExpiresAt: mark.windowExpiresAt } : {}),
    ...(mark.windowOrigin !== null ? { metaWindowOrigin: mark.windowOrigin } : {}),
  };
}
