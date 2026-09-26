"use client";

// Anuncios en el chat (Bandeja y pop-up del Embudo):
// - AdReferralCard: tarjeta compacta de 1–2 líneas (miniatura, "📣 Llegó por
//   anuncio" y el nombre del anuncio), toda clicable → página del anuncio.
//   Nunca la ficha completa.
// - AdFreeWindowNote: junto al aviso de 24 h, la ventana GRATIS de 72 h que
//   abre la primera respuesta a un cliente que llegó por anuncio.
import Link from "next/link";
import { useState } from "react";
import { freeEntryWindow } from "@/lib/ads/free-window";
import type { AdReferral, ConversationDetail } from "@/lib/inbox/types";

export function AdReferralCard({ referral }: { referral: AdReferral }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const icon = referral.mediaType === "video" ? "🎬" : "📣";
  return (
    <Link
      href={referral.href}
      title="Ver el anuncio"
      className="mb-1 flex w-60 max-w-full items-center gap-2 rounded-lg border bg-muted/60 p-1.5 pr-2.5 text-left text-foreground transition-colors hover:bg-muted"
    >
      {referral.thumbnailUrl && !thumbFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={referral.thumbnailUrl}
          alt=""
          onError={() => setThumbFailed(true)}
          className="h-9 w-9 shrink-0 rounded object-cover"
        />
      ) : (
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-brand-orange/10 text-base">
          {icon}
        </span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[11px] font-medium text-brand-orange">📣 Llegó por anuncio</span>
        <span className="block truncate text-xs font-semibold">{referral.name}</span>
      </span>
    </Link>
  );
}

const TIME = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mazatlan",
  weekday: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function AdFreeWindowNote({ adEntry, nowMs }: { adEntry: ConversationDetail["adEntry"]; nowMs: number }) {
  if (!adEntry) return null;
  const fw = freeEntryWindow(
    new Date(adEntry.entryAt),
    adEntry.firstReplyAt ? new Date(adEntry.firstReplyAt) : null,
    new Date(nowMs),
  );
  if (fw?.status === "open") {
    return <span title="Llegó por anuncio: los mensajes (también plantillas) son gratis"> · 🎁 Gratis por anuncio hasta {TIME.format(fw.until)}</span>;
  }
  if (fw?.status === "pending") {
    return <span title="Si respondes antes, se abren 72 h de mensajes gratis"> · 📣 Responde antes de {TIME.format(fw.replyBy)}: 72 h gratis</span>;
  }
  return null;
}
