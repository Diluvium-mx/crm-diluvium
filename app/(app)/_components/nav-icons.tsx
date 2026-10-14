// Íconos del menú lateral (14-oct-2026, propuesta B «estilo Zernio»). Cada uno hace un
// gesto propio UNA vez al pasar el cursor (o llegar con Tab) por su pestaña: las piezas
// que se mueven llevan data-nav-anim y las animaciones viven en app/globals.css ›
// «Íconos del menú». Con "reducir movimiento", nada se mueve.
// Dibujos de Lucide (licencia ISC, la misma familia de lucide-react) escritos aquí a
// mano porque lucide-react entrega el ícono entero y aquí se anima por piezas.
import type { CSSProperties, ReactNode } from "react";

export type NavIconName =
  | "dashboard"
  | "bandeja"
  | "embudo"
  | "mensajes-rapidos"
  | "anuncios"
  | "agente-ia"
  | "automatizacion"
  | "seguimientos"
  | "configuracion";

// Retraso para que las piezas de un mismo ícono entren una tras otra.
const after = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

const ICONS: Record<NavIconName, ReactNode> = {
  // Los cuatro cuadros aparecen uno por uno.
  dashboard: (
    <>
      <rect data-nav-anim="pop" x="3" y="3" width="7" height="9" rx="1" />
      <rect data-nav-anim="pop" style={after(80)} x="14" y="3" width="7" height="5" rx="1" />
      <rect data-nav-anim="pop" style={after(160)} x="14" y="12" width="7" height="9" rx="1" />
      <rect data-nav-anim="pop" style={after(240)} x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  // Los puntitos de «escribiendo» brincan.
  bandeja: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <circle data-nav-anim="bob" cx="8" cy="10" r="0.6" />
      <circle data-nav-anim="bob" style={after(80)} cx="12" cy="10" r="0.6" />
      <circle data-nav-anim="bob" style={after(160)} cx="16" cy="10" r="0.6" />
    </>
  ),
  // Cae una gota de agua por el embudo.
  embudo: (
    <>
      <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
      <path
        data-nav-anim="fall"
        d="M12 4.5c-1 1.4-1.6 2.2-1.6 3a1.6 1.6 0 0 0 3.2 0c0-.8-.6-1.6-1.6-3z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  // El rayo se dibuja.
  "mensajes-rapidos": (
    <path
      data-nav-anim="draw"
      pathLength={1}
      d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
    />
  ),
  // El megáfono se sacude.
  anuncios: (
    <g data-nav-anim="shake">
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </g>
  ),
  // La chispa grande crece y las chicas parpadean.
  "agente-ia": (
    <>
      <path
        data-nav-anim="pop"
        d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
      />
      <g data-nav-anim="twinkle" style={after(80)}>
        <path d="M20 3v4" />
        <path d="M22 5h-4" />
      </g>
      <g data-nav-anim="twinkle" style={after(240)}>
        <path d="M4 17v2" />
        <path d="M5 18H3" />
      </g>
    </>
  ),
  // Se traza la conexión y aparece el segundo paso.
  automatizacion: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <path data-nav-anim="draw" pathLength={1} d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect data-nav-anim="pop" style={after(160)} x="13" y="13" width="8" height="8" rx="2" />
    </>
  ),
  // La estrella da un giro (opiniones después de la compra).
  seguimientos: (
    <path
      data-nav-anim="spin"
      d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
    />
  ),
  // El engrane gira un cuarto de vuelta.
  configuracion: (
    <g data-nav-anim="turn">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      data-nav-icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4 shrink-0 overflow-visible"
    >
      {ICONS[name]}
    </svg>
  );
}
