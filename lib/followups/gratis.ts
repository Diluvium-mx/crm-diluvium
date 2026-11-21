// Hasta cuándo es gratis un chat por el anuncio (G2, 11-nov-2026; docs/seguimientos.md §6). Primero la marca de Meta:
// la ventana de cobro de un saliente que Meta marcó «gratis por anuncio» (free_entry_point; puede durar más de 72 h).
// Sin marca, la regla del CRM: 72 h desde la primera respuesta (≤ 24 h) a quien llegó por un anuncio
// (lib/ads/free-window.ts). null = no hay tiempo gratis vigente.
import { and, eq, gt, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { firstReplyAfter } from "@/lib/ads/queries";
import { freeEntryWindow } from "@/lib/ads/free-window";

// La marca de Meta vigente: hasta cuándo es gratis el chat según Meta (free_entry_point), o null.
export async function metaFreeUntilOf(organizationId: string, conversationId: string, now: Date): Promise<Date | null> {
  const [marca] = await db
    .select({ until: sql<Date | null>`max(${messages.metaWindowExpiresAt})`.mapWith(messages.metaWindowExpiresAt) })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        eq(messages.metaPricingType, "free_entry_point"),
        gt(messages.metaWindowExpiresAt, now),
      ),
    );
  return marca?.until ?? null;
}

// Barra del chat (lib/inbox/window-bar.ts): la marca de Meta de ESTA entrada por anuncio, vigente o vencida. Una marca
// vencida dice que lo gratis ya se acabó (Meta manda): la barra no vuelve a la regla de 72 h. Solo cuenta lo que salió
// desde la entrada, para que la marca de un anuncio viejo no tape una entrada nueva.
export async function metaFreeMarkSince(organizationId: string, conversationId: string, entryAt: Date): Promise<Date | null> {
  const [marca] = await db
    .select({ until: sql<Date | null>`max(${messages.metaWindowExpiresAt})`.mapWith(messages.metaWindowExpiresAt) })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        eq(messages.metaPricingType, "free_entry_point"),
        gte(messages.sentAt, entryAt),
      ),
    );
  return marca?.until ?? null;
}

export async function freeUntilOf(organizationId: string, conversationId: string, adEntryAt: Date | null, now: Date): Promise<Date | null> {
  const marca = await metaFreeUntilOf(organizationId, conversationId, now);
  if (marca) return marca;
  if (!adEntryAt) return null;
  const ventana = freeEntryWindow(adEntryAt, await firstReplyAfter(organizationId, conversationId, adEntryAt), now);
  return ventana?.status === "open" ? ventana.until : null;
}
