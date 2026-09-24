import Link from "next/link";

// Sección "Anuncios" (sidebar): de qué anuncios de Meta llegan los clientes.
//
// Estructura lista para crecer: hoy solo existe la lista de anuncios que
// trajeron clientes y la página de cada anuncio. La fase posterior "Métricas de
// anuncios" (conjuntos, anuncios activos, cuáles traen más clientes, gasto
// contra ventas) se agrega como otra pestaña de SECTION_TABS, sobre las mismas
// tablas (ad_clicks + meta_ads). Con una sola pestaña no se dibuja la barra.
const SECTION_TABS = [{ label: "Anuncios que trajeron clientes", href: "/anuncios" }];

export default function AnunciosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      {SECTION_TABS.length > 1 && (
        <nav className="flex gap-2 border-b text-sm">
          {SECTION_TABS.map((tab) => (
            <Link key={tab.href} href={tab.href} className="px-3 py-2">
              {tab.label}
            </Link>
          ))}
        </nav>
      )}
      {children}
    </div>
  );
}
