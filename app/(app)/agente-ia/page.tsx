import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { getAgentEditor } from "@/lib/actions/agente-ia-editor";
import { AgenteEditor } from "./_components/agente-editor";

// Pestaña "Agente IA" (editor estilo GHL). Solo owner/admin (ACL: recurso
// `aiConfig`); los agentes se redirigen (no es su herramienta). Solo sirve para
// personalizar al agente: los precios de los modelos son internos (gasto).
export default async function AgenteIaPage() {
  const { role } = await requireActiveMembership();
  if (!roleAllows(role, "aiConfig", "read")) {
    redirect("/dashboard");
  }
  return <AgenteEditor data={await getAgentEditor()} />;
}
