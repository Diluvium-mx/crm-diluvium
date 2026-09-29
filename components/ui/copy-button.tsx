"use client";

// Botón «Copiar» (Agente IA › Instrucciones y FAQs; Automatización › Workflows con
// `iconOnly`, solo el ícono, 28-sep-2026): copia al portapapeles
// el texto que da `getText` al momento del clic y confirma con "Copiado" 2 s. Si el
// navegador no deja usar el portapapeles moderno, usa el método viejo; si tampoco,
// avisa "No se pudo copiar".
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

const FEEDBACK_MS = 2_000;

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sin permiso o sin foco: se intenta abajo.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export function CopyButton({
  getText,
  title,
  iconOnly = false,
  className = "",
}: {
  getText: () => string;
  /** Qué copia (tooltip y lector de pantalla), p. ej. "Copiar todas las FAQs". */
  title: string;
  /** Solo el ícono (el texto queda para el lector de pantalla y el tooltip). */
  iconOnly?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    const ok = await writeClipboard(getText());
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), FEEDBACK_MS);
  }

  const label = state === "copied" ? "Copiado" : state === "failed" ? "No se pudo copiar" : "Copiar";
  const icon = iconOnly ? "size-4" : "size-3.5";
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={state === "idle" ? title : label}
      aria-label={title}
      className={`inline-flex shrink-0 items-center text-foreground hover:bg-muted ${
        iconOnly
          ? "justify-center rounded-md border p-2.5"
          : "gap-1.5 rounded border border-black/15 bg-card px-2 py-1 text-xs font-medium shadow-sm dark:border-white/15"
      } ${className}`}
    >
      {state === "copied" ? (
        <Check className={`${icon} text-emerald-600 dark:text-emerald-400`} aria-hidden="true" />
      ) : (
        <Copy className={`${icon} ${state === "failed" ? "text-red-600" : ""}`} aria-hidden="true" />
      )}
      <span aria-live="polite" className={iconOnly ? "sr-only" : undefined}>
        {label}
      </span>
    </button>
  );
}
