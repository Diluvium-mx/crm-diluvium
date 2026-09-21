import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { listSnippets } from "@/lib/actions/snippets";
import { listTemplates } from "@/lib/actions/templates";
import { FragmentosPlantillas } from "./_components/fragmentos-plantillas";

// Sección conjunta Fragmentos (texto libre, dentro de 24 h) + Plantillas
// (aprobadas por Meta, fuera de 24 h). Los datos iniciales se cargan en el
// servidor (acotados a la organización de la sesión); la UI gestiona el resto.
export default async function FragmentosPlantillasPage() {
  const { role } = await requireActiveMembership();
  // Solo owner/admin gestionan fragmentos y plantillas (ACL en
  // lib/auth/permissions.ts). El servidor lo vuelve a exigir en las acciones;
  // esto solo oculta los controles a quien no puede.
  const canManageSnippets = roleAllows(role, "snippet", "create");
  const canManageTemplates = roleAllows(role, "template", "create");
  const [snippets, templates] = await Promise.all([listSnippets(), listTemplates()]);
  return (
    <FragmentosPlantillas
      initialSnippets={snippets}
      initialTemplates={templates}
      canManageSnippets={canManageSnippets}
      canManageTemplates={canManageTemplates}
    />
  );
}
