import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { NavItem } from "./_components/nav-item";
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
    // Automatización (Fase D): editar workflows es configuración (owner/admin);
    // el vendedor los usa desde el composer y no necesita la pestaña.
    ...(role && roleAllows(role, "workflow", "create")
      ? [{ label: "Automatización", href: "/automatizacion" }]
      : []),
    // Configuración va al final: "Mi cuenta" es para todos (A4).
    ...(role ? [{ label: "Configuración", href: "/configuracion" }] : []),
  ];

  return (
    <div className="flex min-h-dvh w-full font-brand">
      {/* Capas: el sidebar va encima (z-20) y proyecta su sombra sobre la barra y
          el contenido; la barra (z-10) proyecta la suya sobre el contenido. Sin
          z-index en <main>: los pop-ups (fixed z-50) siguen tapando todo. */}
      <aside className="relative z-20 flex w-56 shrink-0 flex-col border-r border-white/5 bg-brand-navy bg-linear-to-b from-brand-navy to-[#08477f] shadow-[6px_0_24px_-10px_rgb(4_30_60/0.6)] dark:to-[#073763]">
        <nav aria-label="Principal" className="flex flex-col gap-1 p-3">
          {navItems.map((item) => (
            <NavItem key={item.href} href={item.href} label={item.label} />
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
        <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-brand-navy-dark px-4 py-3 shadow-[0_6px_18px_-8px_rgb(4_30_60/0.55)]">
          <div className="flex shrink-0 items-center rounded-md bg-white px-2.5 py-1.5 shadow-sm ring-1 ring-black/5">
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
