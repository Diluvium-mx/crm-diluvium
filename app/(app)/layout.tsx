import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignOutButton } from "./_components/sign-out-button";

const NAV_ITEMS = [
  { label: "Bandeja / Embudo", href: "/dashboard" },
  { label: "Contactos", href: "/contacts" },
  { label: "Fragmentos", href: "/snippets" },
  { label: "Reportes", href: "/reports" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <div className="flex min-h-full flex-1 font-brand">
      <aside className="flex w-56 shrink-0 flex-col bg-brand-navy">
        <nav className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-3 py-2 text-sm text-brand-white transition-colors hover:bg-white/10"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between bg-brand-navy-dark px-4 py-3">
          <span className="font-semibold text-brand-white">Diluvium</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-brand-white">{session.user.email}</span>
            <SignOutButton />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center bg-background text-muted-foreground">
          {children}
        </main>
      </div>
    </div>
  );
}
