// Marca "IA" del Detalle del contacto (Agente IA parte 1, 26-sep-2026): el Agente IA
// llenó el campo con lo que dijo el cliente y ningún vendedor lo ha editado (al
// editarlo, el campo pasa a ser del vendedor y la marca se va).
export function IaMark() {
  return (
    <span
      title="Lo llenó el Agente IA con lo que dijo el cliente"
      className="ml-1 rounded bg-brand-navy/10 px-1 text-[10px] font-semibold text-brand-navy dark:bg-brand-white/15 dark:text-brand-white"
    >
      IA
    </span>
  );
}
