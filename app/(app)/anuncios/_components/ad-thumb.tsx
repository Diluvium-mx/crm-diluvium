"use client";

// Miniatura del anuncio desde el bucket propio; si no hay (o falla), un ícono.
import { useState } from "react";

export function AdThumb({ src, mediaType, className = "h-14 w-14" }: { src: string | null; mediaType: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" onError={() => setFailed(true)} className={`${className} shrink-0 rounded-md object-cover`} />;
  }
  return (
    <span aria-hidden className={`${className} flex shrink-0 items-center justify-center rounded-md bg-brand-orange/10 text-xl`}>
      {mediaType === "video" ? "🎬" : "📣"}
    </span>
  );
}
