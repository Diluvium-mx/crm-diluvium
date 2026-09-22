import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { listSellers } from "@/lib/actions/team";
import { listSizeRanges } from "@/lib/actions/contact-qualification";
import { MyAccountForm } from "./_components/my-account-form";
import { SellersPanel } from "./_components/sellers-panel";
import { SizeRangesPanel } from "./_components/size-ranges-panel";

// Configuración (A4, al final del sidebar). "Mi cuenta" para todos;
// "Vendedores" y "Tallas" (rangos de A7) solo owner/admin. La pestaña va en la
// URL (?tab=); una pestaña sin permiso cae a "Mi cuenta".
type Tab = "cuenta" | "vendedores" | "tallas";

export default async function ConfiguracionPage({ searchParams }: PageProps<"/configuracion">) {
  const { role } = await requireActiveMembership();
  const session = await auth.api.getSession({ headers: await headers() });
  const canManageTeam = roleAllows(role, "member", "update");
  const canManageSizes = roleAllows(role, "sizeRange", "update");

  const requested = (await searchParams).tab;
  const tab: Tab =
    requested === "vendedores" && canManageTeam ? "vendedores" : requested === "tallas" && canManageSizes ? "tallas" : "cuenta";

  const tabs: { key: Tab; label: string }[] = [
    { key: "cuenta", label: "Mi cuenta" },
    ...(canManageTeam ? [{ key: "vendedores" as const, label: "Vendedores" }] : []),
    ...(canManageSizes ? [{ key: "tallas" as const, label: "Tallas de compuerta" }] : []),
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
              className={`rounded-md px-3 py-1.5 ${tab === t.key ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "cuenta" && <MyAccountForm name={session?.user.name ?? ""} email={session?.user.email ?? ""} />}
      {tab === "vendedores" && <SellersPanel {...await listSellers()} />}
      {tab === "tallas" && <SizeRangesPanel initial={await listSizeRanges()} />}
    </div>
  );
}
