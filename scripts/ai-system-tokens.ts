// Mide el system del "cerebro" (Goal + FAQs) para confirmar que supera el
// mínimo de caché de Anthropic (~1024 tokens para modelos Sonnet/Haiku). Arma el
// system con el MISMO ensamblador del runtime, desde las fuentes versionadas.
//
// Local (sin llave): imprime chars + estimación.
// Conteo REAL:  railway run -e staging -s crm-diluvium npm run ai:system-tokens
//   (usa ANTHROPIC_API_KEY del entorno y el endpoint /v1/messages/count_tokens).
import { readFileSync } from "node:fs";
import { buildBrainSystem, type Faq } from "@/lib/ai/runtime/knowledge";
import { getModel, DEFAULT_BRAIN_MODEL } from "@/lib/ai/catalog";

const goalUrl = new URL("../docs/agente-ia/angela-goal.md", import.meta.url);
const faqsUrl = new URL("../docs/agente-ia/angela-faqs.json", import.meta.url);

function loadFaqs(): Faq[] {
  const parsed = JSON.parse(readFileSync(faqsUrl, "utf8")) as { faqs?: Faq[] };
  return (parsed.faqs ?? []) as Faq[];
}

async function realCountTokens(system: string): Promise<number | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = getModel(DEFAULT_BRAIN_MODEL);
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model?.providerModelId ?? "claude-sonnet-5",
      system,
      messages: [{ role: "user", content: "hola" }],
    }),
  });
  if (!res.ok) throw new Error(`count_tokens HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { input_tokens: number };
  return json.input_tokens;
}

async function main(): Promise<void> {
  const goal = readFileSync(goalUrl, "utf8").trimEnd();
  const faqs = loadFaqs();
  const system = buildBrainSystem(goal, faqs);

  console.log(`Goal:            ${goal.length} chars`);
  console.log(`FAQs:            ${faqs.length}`);
  console.log(`System total:    ${system.length} chars`);
  console.log(`Estimación:      ~${Math.round(system.length / 3.7)} tokens (chars/3.7, aprox. español)`);

  const real = await realCountTokens(system);
  if (real === null) {
    console.log("Conteo REAL:     (sin ANTHROPIC_API_KEY; córrelo con `railway run -e staging`)");
  } else {
    const MIN = 1024;
    console.log(`Conteo REAL:     ${real} tokens (${getModel(DEFAULT_BRAIN_MODEL)?.label ?? DEFAULT_BRAIN_MODEL}, incluye msg de 1 token)`);
    console.log(`Mínimo de caché: ${MIN} → ${real >= MIN ? "SUPERA el mínimo ✅ (cacheable)" : "NO alcanza ❌"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
