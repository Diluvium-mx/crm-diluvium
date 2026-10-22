"use client";

// Franja roja de la Bandeja (P4, 22-oct-2026): 3 o más envíos de la última hora fallaron con el
// MISMO error (p. ej. WhatsApp no pudo bajar las imágenes, como el 21-oct). Se recarga sola cada
// 2 min; las reglas y el texto salen de lib/monitoring/send-failures.ts.
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { loadSendFailureLines } from "@/lib/actions/send-failures";

const REFRESH_MS = 2 * 60_000;

export function SendFailuresBanner({ initial }: { initial: string[] }) {
  const [lines, setLines] = useState(initial);
  useEffect(() => {
    const id = setInterval(() => {
      loadSendFailureLines()
        .then(setLines)
        .catch(() => undefined); // sin conexión: se queda lo último que se vio
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  if (lines.length === 0) return null;
  return (
    <div role="alert" className="flex shrink-0 flex-col">
      {lines.map((text) => (
        <p key={text} className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {text}
        </p>
      ))}
    </div>
  );
}
