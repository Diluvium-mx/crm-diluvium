"use client";

// Ítem del sidebar (compartido por todas las secciones). El activo se resalta con
// fondo más claro, texto en negritas, una barra blanca a la izquierda y una sombra
// leve que lo "levanta"; los demás se iluminan al pasar el cursor (data-glow="light":
// luz blanca sobre navy, app/globals.css). Transiciones suaves; con "reducir
// movimiento" el cambio es inmediato.
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      data-glow="light"
      aria-current={active ? "page" : undefined}
      className={`group flex items-center rounded-md px-3 py-2 text-sm transition-[background-color,color,box-shadow] duration-200 ease-out motion-reduce:transition-none ${
        active
          ? "bg-white/15 font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_6px_14px_-8px_rgb(0_0_0/0.55)]"
          : "text-brand-white/80 hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mr-2.5 h-4 w-1 shrink-0 rounded-full bg-white transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
          active ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0 group-hover:opacity-40"
        }`}
      />
      {label}
    </Link>
  );
}
