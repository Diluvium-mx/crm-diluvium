"use client";

// Menú de la versión móvil (< md): el menú lateral se esconde y en su lugar la barra
// de arriba lleva un botón ☰ que abre este cajón con las MISMAS pestañas (NavItem) y
// el mismo menú del usuario del sidebar. Se cierra al elegir una pestaña, con Esc o
// tocando fuera. Va en un portal sobre <body> para quedar encima de todo (la barra
// tiene su propia capa z-10).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { NavItem } from "./nav-item";
import { UserMenu } from "./user-menu";

export function MobileNav({
  items,
  user,
}: {
  items: { label: string; href: string }[];
  user: { name: string; email: string; roleLabel: string };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Al cambiar de pantalla se cierra (reset en render, sin efecto).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  // Esc cierra; mientras está abierto la página de atrás no se desliza.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        aria-expanded={open}
        className="flex size-10 shrink-0 items-center justify-center rounded-md text-brand-white transition-colors hover:bg-white/10 md:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/50 duration-200 animate-in fade-in-0 motion-reduce:animate-none"
            />
            <nav
              aria-label="Principal"
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-navy bg-linear-to-b from-brand-navy to-[#08477f] shadow-2xl duration-200 ease-out animate-in slide-in-from-left motion-reduce:animate-none dark:to-[#073763]"
            >
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 pr-2 pl-4">
                <span className="text-sm font-semibold text-white">Menú</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar menú"
                  className="flex size-10 items-center justify-center rounded-md text-brand-white transition-colors hover:bg-white/10"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
                {items.map((item) => (
                  <NavItem key={item.href} href={item.href} label={item.label} />
                ))}
              </div>
              <div className="mt-auto border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <UserMenu name={user.name} email={user.email} roleLabel={user.roleLabel} />
              </div>
            </nav>
          </div>,
          document.body,
        )}
    </>
  );
}
