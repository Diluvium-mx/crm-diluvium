"use client";

// Barra de arriba del chat (Bandeja y pop-up del Embudo; 20-nov-2026, propuesta A del dueño): el precio primero, en
// una palabra. Solo pinta: la regla vive en lib/inbox/window-bar.ts. Verde gratis, azul (navy) con costo, ámbar aviso
// o acción, gris no se puede. El por qué y los centavos, al pasar el mouse (title).
import { Archive, Clock, Coins, FileText, FlaskConical, Gift } from "lucide-react";
import type { ComponentType } from "react";
import type { WindowBar, WindowBarIcon, WindowBarTone } from "@/lib/inbox/window-bar";
import { InstagramGlyph } from "../../contactos/_components/contact-avatar";

const TONE: Record<WindowBarTone, string> = {
  gratis: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  costo: "bg-brand-navy/10 text-brand-navy dark:text-sky-300",
  aviso: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  cerrado: "bg-muted text-muted-foreground",
};

const ICON: Record<WindowBarIcon, ComponentType<{ className?: string }>> = {
  gift: Gift,
  coin: Coins,
  clock: Clock,
  template: FileText,
  instagram: InstagramGlyph,
  test: FlaskConical,
  archive: Archive,
};

export function WindowBarView({ bar }: { bar: WindowBar }) {
  const Icon = ICON[bar.icon];
  return (
    <div className={`border-b px-4 py-1.5 text-center text-xs ${TONE[bar.tone]}`} title={bar.title} data-tono={bar.tone}>
      <span aria-hidden="true">
        <Icon className="mr-1 inline size-3.5 align-[-2px]" />
      </span>
      <strong className="font-semibold">{bar.strong}</strong>
      {bar.rest && <span> {bar.rest}</span>}
    </div>
  );
}
