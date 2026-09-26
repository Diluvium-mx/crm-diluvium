"use client";

// Marca "IA" del Detalle del contacto (Agente IA parte 1, 26-sep-2026): el Agente IA
// escribió ese campo al último con lo que dijo el cliente (si un vendedor lo edita, la
// marca se va; si después el agente lo corrige, vuelve). `active` = lo acaba de llenar:
// el mismo orbe del indicador del chat ("actualizando") por un par de segundos.
import { useTheme } from "next-themes";
import { ThinkingOrb } from "thinking-orbs";

export function IaMark({ active = false }: { active?: boolean }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <span
      title="Lo llenó el Agente IA con lo que dijo el cliente"
      className="inline-flex shrink-0 items-center gap-1 rounded bg-brand-navy/10 px-1 text-[10px] font-semibold text-brand-navy dark:bg-brand-white/15 dark:text-brand-white"
    >
      {active && (
        // El orbe más chico del paquete es de 20 px: se reduce a ~12 px.
        <span aria-hidden="true" className="flex size-3 items-center justify-center">
          <span className="scale-[0.6]">
            <ThinkingOrb state="composing" size={20} theme={dark ? "dark" : "light"} color={dark ? "#9ec3f0" : "#0A559A"} />
          </span>
        </span>
      )}
      IA
      {active && <span className="font-normal">actualizando</span>}
    </span>
  );
}
