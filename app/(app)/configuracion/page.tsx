import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { listSellers } from "@/lib/actions/team";
import { SellersPanel } from "./_components/sellers-panel";

// Configuración (al final del sidebar): SOLO owner/admin (ACL `settings`), también
// por URL directa: el vendedor vuelve al Dashboard. Hoy solo "Vendedores". "Mi cuenta"
// es /mi-cuenta (menú del usuario) y "Tallas" vive en la pestaña Agente IA desde el
// 26-sep-2026 ("Tallas y medidas"); los enlaces viejos ?tab= llevan a cada destino.
export default async function ConfiguracionPage({ searchParams }: PageProps<"/configuracion">) {
  const requested = (await searchParams).tab;
  if (requested === "cuenta") redirect("/mi-cuenta");
  if (requested === "tallas") redirect("/agente-ia?seccion=tallas");

  const { role } = await requireActiveMembership();
  if (!roleAllows(role, "settings", "read")) redirect("/inicio");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Configuración</h1>
        <span className="ml-auto rounded-md bg-muted px-3 py-1.5 text-sm font-medium">Vendedores</span>
      </header>

      <SellersPanel {...await listSellers()} />
    </div>
  );
}
