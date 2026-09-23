// "Gasto de IA" (solo owner/admin). PLACEHOLDER: los datos llegan de ai_usage
// cuando el Agente IA responda de verdad (Fase B). Ni OpenAI ni Anthropic dan
// el saldo por API, solo el gasto: el saldo será una ESTIMACIÓN (crédito
// cargado a mano − gasto). Ver docs/investigacion/gasto-ia-saldo.md.
export function AiSpendCard() {
  return (
    <div className="rounded-lg border border-dashed bg-card p-4">
      <h2 className="text-sm font-semibold">Gasto de IA</h2>
      <p className="mt-2 text-xs text-muted-foreground">
        Disponible cuando el Agente IA empiece a responder. Aquí se verá el gasto del mes por proveedor y un
        saldo estimado (crédito cargado menos gasto).
      </p>
    </div>
  );
}
