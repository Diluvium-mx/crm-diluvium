import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { getAiConfig } from "@/lib/actions/ai-config";
import { buildModelOptions } from "@/lib/agente-ia/options";
import { AgenteIaPanel } from "./_components/agente-ia-panel";

// Pestaña "Agente IA" (Fase A: Fundación del modelo). Solo owner/admin (ACL:
// recurso `aiConfig`); los agentes se redirigen (no es su herramienta). Deja el
// mecanismo del modelo listo y seleccionable; el agente todavía NO responde a
// clientes (eso llega en briefs siguientes).
export default async function AgenteIaPage() {
  const { role } = await requireActiveMembership();
  if (!roleAllows(role, "aiConfig", "read")) {
    redirect("/dashboard");
  }
  const config = await getAiConfig();
  const filterOptions = buildModelOptions("filtro");
  const brainOptions = buildModelOptions("cerebro");
  return (
    <AgenteIaPanel config={config} filterOptions={filterOptions} brainOptions={brainOptions} />
  );
}
