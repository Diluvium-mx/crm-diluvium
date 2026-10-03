// Seguimientos que ya hizo un VENDEDOR (decisión del dueño, 3-oct-2026: cuentan como intento).
// PURO. Se mira la cola del chat: lo que mandó la empresa después del último mensaje del
// cliente, partido en tandas (una tanda nueva empieza tras 8 h sin mensajes). La primera tanda
// es la PARADA; cada tanda posterior con un mensaje de vendedor (CRM o celular) es un
// seguimiento suyo, y cuenta como un intento ya hecho.
import { MIN_SILENCE_MS } from "./cases";

export type TailMessage = {
  direction: "in" | "out";
  source: string;
  sentByUserId?: string | null;
  at: Date;
};

export function isVendorMessage(m: TailMessage): boolean {
  return m.direction === "out" && (m.source === "business_app" || (m.source === "crm" && Boolean(m.sentByUserId)));
}

export type ChatTail = {
  /** La parada: el último mensaje de la primera tanda después del cliente. */
  stopAt: Date;
  /** Cuándo mandó un vendedor cada seguimiento posterior (en orden). */
  vendorAttempts: Date[];
};

/** null si el último mensaje es del cliente (no hay seguimiento) o el chat está vacío. */
export function chatTail(rows: readonly TailMessage[]): ChatTail | null {
  if (rows.length === 0 || rows[rows.length - 1].direction === "in") return null;
  let start = rows.length;
  while (start > 0 && rows[start - 1].direction === "out") start--;
  const tail = rows.slice(start);
  const bursts: TailMessage[][] = [];
  for (const m of tail) {
    const last = bursts[bursts.length - 1]?.at(-1);
    if (!last || m.at.getTime() - last.at.getTime() >= MIN_SILENCE_MS) bursts.push([m]);
    else bursts[bursts.length - 1].push(m);
  }
  const vendorAttempts: Date[] = [];
  for (const burst of bursts.slice(1)) {
    const vendor = burst.find(isVendorMessage);
    if (vendor) vendorAttempts.push(vendor.at);
  }
  // Sin seguimientos del vendedor, la parada es el último mensaje (como siempre).
  const stopAt = vendorAttempts.length ? bursts[0][bursts[0].length - 1].at : tail[tail.length - 1].at;
  return { stopAt, vendorAttempts };
}
