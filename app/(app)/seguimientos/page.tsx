import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { googleResenaUrl, listarOpiniones } from "@/lib/opiniones/queries";
import { opinionVista } from "@/lib/opiniones/vista";
import { parseSeguimientosSection } from "@/lib/seguimientos/sections";
import { SeguimientosPanel } from "./_components/seguimientos-panel";

// Pestaña «Seguimientos» del menú (7-oct-2026, docs/opiniones.md): lo que sigue
// después de la compra. Hoy una subpestaña, «Opinión». Todos los roles la ven,
// vendedor incluido (ACL `opinion`). Distinta de Agente IA › Seguimientos.
export default async function SeguimientosPage({ searchParams }: PageProps<"/seguimientos">) {
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "opinion", "read")) {
    redirect("/dashboard");
  }
  const seccion = parseSeguimientosSection((await searchParams).seccion);
  const [filas, google] = await Promise.all([listarOpiniones(organizationId), googleResenaUrl(organizationId)]);
  const appUrl = process.env.APP_URL ?? "";
  return (
    <SeguimientosPanel
      seccionInicial={seccion}
      opiniones={filas.map((f) => opinionVista(f, appUrl))}
      googleUrl={google}
      puede={{
        crear: roleAllows(role, "opinion", "create"),
        editar: roleAllows(role, "opinion", "update"),
        borrar: roleAllows(role, "opinion", "delete"),
      }}
    />
  );
}
