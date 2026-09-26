import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { getAgentEditor } from "@/lib/actions/agente-ia-editor";
import { listSizeRanges } from "@/lib/actions/contact-qualification";
import { AgenteEditor } from "./_components/agente-editor";

// Pestaña "Agente IA" (editor estilo GHL). Todos los roles la ven y editan,
// vendedor incluido (ACL: recurso `aiConfig`; un rol sin permiso vuelve a la
// Bandeja). Solo sirve para personalizar al agente: los precios de los modelos
// son internos (gasto). "Tallas y medidas" (rangos de ancho por tamaño) vive aquí
// desde el 26-sep-2026; antes estaba en Configuración.
export default async function AgenteIaPage() {
  const { role } = await requireActiveMembership();
  if (!roleAllows(role, "aiConfig", "read")) {
    redirect("/dashboard");
  }
  const [data, sizeRanges] = await Promise.all([getAgentEditor(), listSizeRanges()]);
  return <AgenteEditor data={data} sizeRanges={sizeRanges} />;
}
