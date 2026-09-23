import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { SignOutButton } from "./_components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";

// "Dashboard" va primero y es el destino al entrar (/inicio). La Bandeja
// conserva su URL histórica /dashboard. "Reportes" (/reports, sin página) se
// reemplazó por el Dashboard.
const NAV_ITEMS = [
  { label: "Dashboard", href: "/inicio" },
  { label: "Bandeja", href: "/dashboard" },
  { label: "Embudo", href: "/embudo" },
  { label: "Mensajes rápidos", href: "/mensajes-rapidos" },
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

  // La pestaña "Agente IA" es configuración del CRM: solo owner/admin (ACL:
  // recurso `aiConfig` en lib/auth/permissions.ts). Se resuelve el rol contra la
  // membresía vigente; si por alguna razón no hay membresía, la pestaña no se
  // muestra (falla cerrado).
  let role: string | null = null;
  try {
    role = (await requireActiveMembership()).role;
  } catch {
    role = null;
  }
  const navItems = [
    ...NAV_ITEMS,
    ...(role && roleAllows(role, "aiConfig", "read")
      ? [{ label: "Agente IA", href: "/agente-ia" }]
      : []),
    // Configuración va al final: "Mi cuenta" es para todos (A4).
    ...(role ? [{ label: "Configuración", href: "/configuracion" }] : []),
  ];

  return (
    <div className="flex min-h-dvh w-full font-brand">
      <aside className="flex w-56 shrink-0 flex-col bg-brand-navy">
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((item) => (
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

      {/* min-w-0: sin él, esta columna crece al ancho de su contenido (el
          kanban de 5 etapas) y el scroll horizontal se va a toda la página en
          vez de quedarse dentro del tablero (B3). */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Alto GARANTIZADO de 4rem: h-16 fija la altura y shrink-0 evita que
            se comprima. El board de Contactos y la bandeja restan justo 4rem
            (h-[calc(100dvh-4rem)]); si el header pudiera crecer (email largo,
            zoom, ventana angosta) ese cálculo dejaría de cuadrar. El email se
            trunca para no desbordar ni forzar más alto. */}
        <header className="flex h-16 shrink-0 items-center justify-between bg-brand-navy-dark px-4 py-3">
          <div className="flex shrink-0 items-center rounded-md bg-white px-2.5 py-1.5">
            <Image
              src="/logo-diluvium.png"
              alt="Diluvium — Control de inundaciones"
              width={115}
              height={28}
              priority
            />
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 truncate text-sm text-brand-white">{session.user.email}</span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>

        <main className="flex flex-1 flex-col bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
