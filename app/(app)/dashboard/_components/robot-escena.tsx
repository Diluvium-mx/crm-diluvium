// Escenas del robot del seguimiento (9-oct-2026, prototipo aprobado por el dueño): animaciones cortas DENTRO de la
// píldora 🤖 del composer cuando cambia su estado. «disparo» (pasa a Cancelado, 1.9 s): sale una pistola por la
// izquierda y le dispara; el robot hace cortocircuito (chispas, la antena parpadea y le brincan tres cables de la
// cabeza), se le ponen los ojos en X y la pistola gira como de vaquero y se regresa. El último cuadro es idéntico a
// public/emoji/robot-cancelado.svg. Solo dibujo: cuándo se juega lo decide la píldora (followup-pill.tsx). Tiempos y
// movimientos en app/globals.css › "Robot del seguimiento"; con «reducir movimiento» se ve directo el cuadro final.

export type Escena = "disparo";

/** Lo que dura cada escena (lo mismo que `--re-d` en globals.css). */
export const ESCENA_MS: Readonly<Record<Escena, number>> = { disparo: 1900 };

/** El robot de 18 px de la píldora, dibujado en línea para poder animar ojos, boca, antena, cables y chispas. */
export function RobotEscena({ escena }: { escena: Escena }) {
  return (
    <span aria-hidden="true" data-escena={escena} className={`robot-escena robot-escena-${escena} relative -my-0.5 inline-block size-[18px] shrink-0`}>
      <svg className="re-pistola" viewBox="0 0 26 16">
        <rect className="re-pistola-oscuro" x="5" y="0" width="2" height="1.6" />
        <rect className="re-pistola-cuerpo" x="3" y="1" width="21" height="6" rx="1.5" />
        <rect className="re-pistola-oscuro" x="21.5" y="2" width="3.5" height="4" rx=".6" />
        <rect className="re-pistola-brillo" x="4.5" y="2.2" width="16" height="1.1" />
        <path className="re-pistola-guarda" d="M12.5 7 q0 4 4 4 h.8 v-4" fill="none" strokeWidth="1.4" />
        <path className="re-pistola-oscuro" d="M6 7 L13 7 L11 15.4 Q10.7 16 10 16 L4.6 16 Q3.7 16 3.9 15 Z" />
      </svg>
      <svg className="re-fogonazo" viewBox="0 0 10 10">
        <polygon points="5,0 6.2,3.6 10,5 6.2,6.4 5,10 3.8,6.4 0,5 3.8,3.6" fill="#FE9F29" />
        <circle cx="5" cy="5" r="1.8" fill="#FFE066" />
      </svg>
      <span className="re-bala" />
      <span className="re-humo" />
      <span className="re-humo re-humo-2" />
      <svg className="re-robot" viewBox="0 0 64 64" width="18" height="18">
        <g className="re-cuerpo">
          <line x1="32" y1="6" x2="32" y2="13" stroke="#7D8A97" strokeWidth="4.5" strokeLinecap="round" />
          <circle className="re-antena" cx="32" cy="5.5" r="5" fill="#E5484D" />
          <rect x="2" y="27" width="7" height="16" rx="3" fill="#8C99A6" />
          <rect x="55" y="27" width="7" height="16" rx="3" fill="#8C99A6" />
          <rect x="7" y="12" width="50" height="46" rx="13" fill="#C9D3DD" stroke="#7D8A97" strokeWidth="2" />
          <rect x="13" y="20" width="38" height="24" rx="8" fill="#22303F" />
          <g className="re-ojos">
            <rect x="19" y="26" width="9" height="11" rx="4.5" fill="#5FE0F0" />
            <rect x="36" y="26" width="9" height="11" rx="4.5" fill="#5FE0F0" />
          </g>
          <g className="re-ojos-x" stroke="#FF8A8A" strokeWidth="3.2" strokeLinecap="round">
            <line x1="18.5" y1="26.5" x2="27.5" y2="36.5" />
            <line x1="27.5" y1="26.5" x2="18.5" y2="36.5" />
            <line x1="36.5" y1="26.5" x2="45.5" y2="36.5" />
            <line x1="45.5" y1="26.5" x2="36.5" y2="36.5" />
          </g>
          <rect className="re-boca" x="24" y="49" width="16" height="4" rx="2" fill="#5B6876" />
          <ellipse className="re-boca-o" cx="32" cy="51" rx="4" ry="3.2" fill="#5B6876" />
          <g className="re-cables" fill="none" strokeWidth="3.6" strokeLinecap="round">
            <path pathLength={1} d="M14 15 C6 3 -4 8 -7 17" stroke="#E5484D" />
            <path pathLength={1} d="M50 15 C58 2 69 7 71 17" stroke="#3B82F6" />
            <path pathLength={1} d="M40 12 C42 2 51 -1 55 4" stroke="#22A06B" />
          </g>
          <g className="re-cables" fill="#E89B4A">
            <circle cx="-7" cy="17" r="2.6" />
            <circle cx="71" cy="17" r="2.6" />
            <circle cx="55" cy="4" r="2.2" />
          </g>
          <g className="re-chispas re-chispas-1" fill="none" stroke="#FFC300" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M-5 9 L-10 5 L-6 3 L-12 -2" />
            <path d="M60 0 L64 -4" />
            <circle cx="74" cy="10" r="1.8" fill="#FFC300" stroke="none" />
          </g>
          <g className="re-chispas re-chispas-2" fill="none" stroke="#FFC300" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M69 9 L74 5 L70 3 L76 -2" />
            <path d="M4 2 L0 -2" />
            <circle cx="-10" cy="12" r="1.8" fill="#FFC300" stroke="none" />
          </g>
        </g>
      </svg>
    </span>
  );
}
