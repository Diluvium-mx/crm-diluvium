import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { getAiConfig } from "@/lib/actions/ai-config";
import { getAgentSettings } from "@/lib/actions/agente-ia-settings";
import { buildModelOptions } from "@/lib/agente-ia/options";
import { AgenteIaPanel } from "./_components/agente-ia-panel";

// Pestaña "Agente IA". Solo owner/admin (ACL: recurso `aiConfig`); los agentes
// se redirigen (no es su herramienta). Modelos (Fase A) + interruptor por canal,
// tiempos, pausas, límites y precios del runtime (Fase B).
export default async function AgenteIaPage() {
  const { role } = await requireActiveMembership();
  if (!roleAllows(role, "aiConfig", "read")) {
    redirect("/dashboard");
  }
  const [config, bundle] = await Promise.all([getAiConfig(), getAgentSettings()]);
  const filterOptions = buildModelOptions("filtro");
  const brainOptions = buildModelOptions("cerebro");
  return (
    <AgenteIaPanel config={config} filterOptions={filterOptions} brainOptions={brainOptions} bundle={bundle} />
  );
}
