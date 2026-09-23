// Dry-run de un modelo del catálogo: confirma su model-id de API, el reporte de
// uso y el costo calculado. NO toca la base ni WhatsApp; solo llama al proveedor.
// Uso: railway run -e staging -s crm-diluvium npm run ai:dry-run -- <modelId>
import { callModel, getModel } from "@/lib/ai";
import { computeCostUsd, resolveModelPrice } from "@/lib/ai/pricing";

async function main(): Promise<void> {
  const modelId = process.argv[2];
  const model = modelId ? getModel(modelId) : undefined;
  if (!model) throw new Error(`Uso: ai:dry-run <modelId del catálogo> (recibí: ${modelId ?? "nada"})`);
  const started = Date.now();
  const result = await callModel(model.id, {
    system: "Eres un asistente de pruebas. Responde en una sola línea, en español.",
    messages: [{ role: "user", content: "Di 'ok' y el nombre de tu modelo." }],
    maxOutputTokens: 300,
  });
  const cost = computeCostUsd(result.usage, resolveModelPrice(model.id, model.provider));
  console.log(`modelo: ${result.modelId} → API ${result.providerModelId} (${result.provider})`);
  console.log(`respuesta (${result.finishReason}): ${result.text.trim()}`);
  console.log(`uso: ${JSON.stringify(result.usage)} | ${Date.now() - started} ms | cost_usd ${cost}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
