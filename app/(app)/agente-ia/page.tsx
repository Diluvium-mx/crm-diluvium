import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { getAgentEditor } from "@/lib/actions/agente-ia-editor";
import { listSizeRanges } from "@/lib/actions/contact-qualification";
import { parseAgentSection } from "@/lib/agente-ia/sections";
import { tableToInput } from "@/lib/followups/tabla";
import { loadFollowUpTableFresh, loadLastTableChange } from "@/lib/followups/tabla-store";
import { AgenteEditor } from "./_components/agente-editor";

// Pestaña "Agente IA" (editor estilo GHL). Todos los roles la ven y editan,
// vendedor incluido (ACL: recurso `aiConfig`; un rol sin permiso vuelve a la
// Bandeja). Solo sirve para personalizar al agente: los precios de los modelos
// son internos (gasto). "Tallas y medidas" (rangos de ancho por tamaño) vive aquí
// desde el 26-sep-2026; antes estaba en Configuración. Desde el 27-sep-2026 va en
// subpestañas; la elegida viene en ?seccion= (modelos | etapas | goal | faqs | opciones |
// seguimientos | tallas | canales | historial; por defecto modelos). «Seguimientos» (6-oct-2026) = la
// tabla de casos de los seguimientos del Agente IA (lib/followups/tabla.ts). "Historial" (28-sep-2026) = quién
// cambió qué y cuándo; se carga al abrir la subpestaña.
export default async function AgenteIaPage({ searchParams }: PageProps<"/agente-ia">) {
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "aiConfig", "read")) {
    redirect("/dashboard");
  }
  const initialSection = parseAgentSection((await searchParams).seccion);
  const [data, sizeRanges, followUpTable, followUpLast] = await Promise.all([
    getAgentEditor(),
    listSizeRanges(),
    loadFollowUpTableFresh(organizationId),
    loadLastTableChange(organizationId),
  ]);
  // Historial → Vendedores: solo owner/admin (la acción lo vuelve a revisar).
  const canSeeSellers = roleAllows(role, "member", "update");
  return (
    <AgenteEditor
      data={data}
      sizeRanges={sizeRanges}
      followUps={{ table: tableToInput(followUpTable), lastChange: followUpLast ? { author: followUpLast.author, at: followUpLast.at.toISOString() } : null }}
      initialSection={initialSection}
      canSeeSellers={canSeeSellers}
    />
  );
}
