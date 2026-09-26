import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { getMediaAssets } from "@/lib/actions/media-library";
import { listWorkflowRuns, listWorkflows } from "@/lib/actions/workflows";
import { AutomatizacionPanel } from "./_components/automatizacion-panel";

// Pestaña "Automatización" (Fase D). Todos los roles editan workflows y su
// biblioteca de media, vendedor incluido (ACL `workflow` y `mediaAsset`), y los
// usan desde el composer ("/tabla"). Los datos iniciales se cargan en el
// servidor, acotados a la organización de la sesión.
export default async function AutomatizacionPage() {
  const { role } = await requireActiveMembership();
  if (!roleAllows(role, "workflow", "update")) {
    redirect("/dashboard");
  }
  const [workflows, assets, runs] = await Promise.all([listWorkflows(), getMediaAssets(), listWorkflowRuns()]);
  return <AutomatizacionPanel initialWorkflows={workflows} initialAssets={assets} initialRuns={runs} />;
}
