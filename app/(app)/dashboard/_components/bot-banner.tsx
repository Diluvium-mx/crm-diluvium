"use client";

// Franja de la Bandeja (Bloque C): avisa a los vendedores cuando el bot NO contesta
// todo — tiene horario (no 24/7) o un canal está Apagado. Se recalcula cada minuto
// aquí mismo (el horario abre y cierra sin recargar). Solo pinta lo que decide
// lib/monitoring/bot-status.ts con datos del CRM (sin llamar a Zernio).
import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { botBanner, type BotBannerData } from "@/lib/monitoring/bot-status";

const TONE = {
  red: "border-destructive/30 bg-destructive/5 text-destructive",
  amber: "border-brand-orange/40 bg-brand-orange/10 text-foreground",
  neutral: "border-border bg-muted/50 text-muted-foreground",
} as const;

export function BotBanner({ data, renderedAt }: { data: BotBannerData; renderedAt: string }) {
  // La 1.ª pintura usa la hora del servidor (misma que el HTML); luego, cada minuto, la del navegador.
  const [now, setNow] = useState(() => new Date(renderedAt));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const lines = botBanner({ ...data, now });
  if (lines.length === 0) return null;
  return (
    <div role="status" className="flex shrink-0 flex-col">
      {lines.map((line) => (
        <p key={line.text} className={`flex items-center gap-2 border-b px-4 py-1.5 text-xs ${TONE[line.tone]}`}>
          <Bot className="size-3.5 shrink-0" aria-hidden="true" />
          {line.text}
        </p>
      ))}
    </div>
  );
}
