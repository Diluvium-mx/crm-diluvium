// Etiqueta "Prueba" (docs/numero-prueba.md): conversación de un canal de prueba o
// contacto que solo habla por canales de prueba. Discreta pero visible, para que
// nadie confunda un chat de prueba con un cliente real.
export function PruebaBadge() {
  return (
    <span
      title="Canal de prueba: no cuenta en el Dashboard"
      className="shrink-0 rounded-full border border-dashed border-amber-500/60 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300"
    >
      Prueba
    </span>
  );
}
