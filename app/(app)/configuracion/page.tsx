import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { listSellers } from "@/lib/actions/team";
import { listSizeRanges } from "@/lib/actions/contact-qualification";
import { SellersPanel } from "./_components/sellers-panel";
import { SizeRangesPanel } from "./_components/size-ranges-panel";

// Configuración (al final del sidebar): SOLO owner/admin (ACL `settings`), también
// por URL directa: el vendedor vuelve al Dashboard. "Vendedores" y "Tallas" (rangos
// de A7). La pestaña va en la URL (?tab=). "Mi cuenta" ahora es /mi-cuenta (menú del
// usuario); el enlace viejo ?tab=cuenta lleva ahí.
type Tab = "vendedores" | "tallas";

export default async function ConfiguracionPage({ searchParams }: PageProps<"/configuracion">) {
  const requested = (await searchParams).tab;
  if (requested === "cuenta") redirect("/mi-cuenta");

  const { role } = await requireActiveMembership();
  if (!roleAllows(role, "settings", "read")) redirect("/inicio");

  const tab: Tab = requested === "tallas" ? "tallas" : "vendedores";
  const tabs: { key: Tab; label: string }[] = [
    { key: "vendedores", label: "Vendedores" },
    { key: "tallas", label: "Tallas de compuerta" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Configuración</h1>
        <nav className="ml-auto flex gap-1 rounded-lg bg-muted p-1 text-sm">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/configuracion?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              data-link="tab"
              className={`rounded-md px-3 py-1.5 ${tab === t.key ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "vendedores" && <SellersPanel {...await listSellers()} />}
      {tab === "tallas" && <SizeRangesPanel initial={await listSizeRanges()} />}
    </div>
  );
}
