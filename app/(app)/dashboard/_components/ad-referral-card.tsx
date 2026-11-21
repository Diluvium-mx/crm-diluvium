"use client";

// Anuncios en el chat (Bandeja y pop-up del Embudo):
// - AdReferralCard: tarjeta compacta de 1–2 líneas (miniatura, "📣 Llegó por
//   anuncio" y el nombre del anuncio), toda clicable → página del anuncio.
//   Nunca la ficha completa.
// La ventana GRATIS del anuncio ya no va aquí: la dice la barra de arriba del chat
// (20-nov-2026; lib/inbox/window-bar.ts).
import Link from "next/link";
import { useState } from "react";
import type { AdReferral } from "@/lib/inbox/types";

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
