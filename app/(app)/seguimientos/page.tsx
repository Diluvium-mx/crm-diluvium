import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { googleResenaUrl, listarOpiniones } from "@/lib/opiniones/queries";
import { opinionVista } from "@/lib/opiniones/vista";
import { listarResenasTienda } from "@/lib/resenas-tienda/queries";
import { resenaVista } from "@/lib/resenas-tienda/vista";
import { parseSeguimientosSection } from "@/lib/seguimientos/sections";
import { SeguimientosPanel } from "./_components/seguimientos-panel";

// Pestaña «Seguimientos» del menú (7-oct-2026, docs/opiniones.md): lo que sigue
// después de la compra. Subpestañas «Opinión» y, desde el 27-oct-2026, «Amazon y Mercado
// Libre». Todos los roles la ven, vendedor incluido (ACL `opinion`). Distinta de
// Agente IA › Seguimientos.
export default async function SeguimientosPage({ searchParams }: PageProps<"/seguimientos">) {
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "opinion", "read")) {
    redirect("/dashboard");
  }
  const seccion = parseSeguimientosSection((await searchParams).seccion);
  const [filas, google, resenas] = await Promise.all([
    listarOpiniones(organizationId),
    googleResenaUrl(organizationId),
    listarResenasTienda(organizationId),
  ]);
  const appUrl = process.env.APP_URL ?? "";
  const now = new Date();
  return (
    <SeguimientosPanel
      seccionInicial={seccion}
      opiniones={filas.map((f) => opinionVista(f, appUrl))}
      googleUrl={google}
      resenas={resenas.flatMap((r) => resenaVista(r, now) ?? [])}
      puede={{
        crear: roleAllows(role, "opinion", "create"),
        editar: roleAllows(role, "opinion", "update"),
        borrar: roleAllows(role, "opinion", "delete"),
      }}
    />
  );
}
