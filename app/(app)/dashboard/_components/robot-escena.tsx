// Escenas del robot del seguimiento (9-oct-2026, prototipos aprobados por el dueño): animaciones cortas DENTRO de la
// píldora 🤖 del composer cuando cambia su estado. Solo dibujo: cuándo se juega cada una está en robot-escena-cuando.ts
// y los movimientos en app/globals.css › "Robot del seguimiento"; con «reducir movimiento» se ve directo el cuadro
// final, que es idéntico a la carita de public/emoji/ del estado nuevo.
// - disparo (pasa a Cancelado): una pistola sale por la izquierda y le dispara; cortocircuito, cables y ojos en X; la
//   pistola gira como de vaquero y se regresa.
// - reparacion-golpes → reparacion / reparacion-dormido (Reactivar): una llave inglesa entra por la derecha (a la
//   izquierda del robot no cabe cuando la píldora lleva la hora) y le da dos golpes; el robot se queda «cargando» hasta
//   que se sabe el final y entonces abre los ojos y brinca, o bosteza y se duerme.
// - reloj (Cambiar hora): los ojos se vuelven relojes que giran y la hora de la píldora cambia.
// - despertador (Que salga solo): suena un despertador, el robot despierta, lo apaga y la píldora pasa a azul.
// - avion (salió el mensaje): lanza un avioncito de papel y la píldora dice la hora nueva o «esperando».
// - cafe → cafe-despierto / cafe-dormido (Despertar, 10-oct-2026): llega una taza de café humeante por la derecha, el
//   robot la huele y sorbe «cargando» mientras el Agente IA lee el chat; al final se la toma, abre los ojos y brinca, o
//   deja la taza, bosteza y se vuelve a dormir.
import type { Escena, RobotFace } from "./robot-escena-cuando";

/** El robot de 18 px de la píldora, dibujado en línea para poder animar ojos, boca, antena, cables y chispas. */
export function RobotEscena({ escena }: { escena: Escena }) {
  return (
    <span aria-hidden="true" data-escena={escena} className={`robot-escena robot-escena-${escena} relative -my-0.5 inline-block size-[18px] shrink-0`}>
      {escena === "disparo" && <Pistola />}
      {(escena === "reparacion-golpes" || escena === "reparacion" || escena === "reparacion-dormido") && <Llave />}
      {escena === "despertador" && <Despertador />}
      {escena === "avion" && <Avioncito />}
      {(escena === "cafe" || escena === "cafe-despierto" || escena === "cafe-dormido") && <Taza />}
      <RobotSvg />
    </span>
  );
}

/** El robot de la píldora sin escena (10-oct-2026, pedido del dueño): el mismo dibujo en línea que el de las escenas, con
 * la carita fija. Antes era una <img> de public/emoji/ y al terminar la escena el cambio dejaba la píldora un instante
 * sin robot (la imagen se cargaba y pintaba de nuevo): se veía un parpadeo. */
export function RobotQuieto({ cara }: { cara: RobotFace }) {
  return (
    <span aria-hidden="true" className={`robot-escena robot-quieto-${cara} relative -my-0.5 inline-block size-[18px] shrink-0`}>
      <RobotSvg />
    </span>
  );
}

function RobotSvg() {
  return (
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
          <g className="re-ojos-dormido" fill="none" stroke="#5FE0F0" strokeWidth="3" strokeLinecap="round">
            <path d="M18.5 31.5 q4.5 4.5 9 0" />
            <path d="M36.5 31.5 q4.5 4.5 9 0" />
          </g>
          <g className="re-ojos-felices" fill="none" stroke="#5FE0F0" strokeWidth="3.2" strokeLinecap="round">
            <path d="M18.5 34 q4.5 -7 9 0" />
            <path d="M36.5 34 q4.5 -7 9 0" />
          </g>
          <g className="re-ojos-cargando" fill="#5FE0F0">
            <circle cx="23" cy="32" r="2.6" />
            <circle cx="32" cy="32" r="2.6" />
            <circle cx="41" cy="32" r="2.6" />
          </g>
          <g className="re-ojos-reloj">
            <circle cx="23.5" cy="31.5" r="6.2" fill="#5FE0F0" />
            <circle cx="40.5" cy="31.5" r="6.2" fill="#5FE0F0" />
            <g stroke="#22303F" strokeLinecap="round">
              <line className="re-manecilla re-manecilla-1" x1="23.5" y1="31.5" x2="23.5" y2="27" strokeWidth="1.8" />
              <line x1="23.5" y1="31.5" x2="26.5" y2="31.5" strokeWidth="1.6" />
              <line className="re-manecilla re-manecilla-2" x1="40.5" y1="31.5" x2="40.5" y2="27" strokeWidth="1.8" />
              <line x1="40.5" y1="31.5" x2="43.5" y2="31.5" strokeWidth="1.6" />
            </g>
          </g>
          <rect className="re-boca" x="24" y="49" width="16" height="4" rx="2" fill="#5B6876" />
          <ellipse className="re-boca-o" cx="32" cy="51" rx="4" ry="3.2" fill="#5B6876" />
          <rect className="re-boca-dormida" x="27" y="49.5" width="10" height="3.5" rx="1.75" fill="#5B6876" />
          <g className="re-zzz" fill="none" stroke="#4A7BD0" strokeLinecap="round" strokeLinejoin="round">
            <path d="M41 3 h9 l-9 9 h9" strokeWidth="3.4" />
            <path d="M54 1.5 h7 l-7 7 h7" strokeWidth="3" />
          </g>
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
  );
}

/** La hora (o «esperando») mientras corre una escena: la de antes se va y la nueva llega (reloj y avión). Las dos van
 * encimadas en la misma celda para que el espacio mida lo que la más larga y ninguna se corte. */
export function EtiquetaEscena({ antes, ahora }: { antes: string | null; ahora: string }) {
  return (
    <span className="grid min-w-0 overflow-hidden">
      {antes && antes !== ahora && (
        <span aria-hidden="true" className="re-etiqueta-antes col-start-1 row-start-1 truncate">
          {antes}
        </span>
      )}
      <span className="re-etiqueta col-start-1 row-start-1 truncate">{ahora}</span>
    </span>
  );
}

function Pistola() {
  return (
    <>
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
    </>
  );
}

/** Llave inglesa con la boca hacia la izquierda (hacia el robot) y las dos estrellitas de los golpes. */
function Llave() {
  return (
    <>
      <svg className="re-llave" viewBox="0 0 26 12">
        <rect className="re-llave-metal" x="9" y="4.2" width="17" height="3.6" rx="1.8" />
        <rect className="re-llave-metal" x="5" y="1.6" width="6.5" height="8.8" rx="2.6" />
        <rect className="re-llave-metal" x="0.2" y="0.4" width="6.8" height="3.3" rx="1.4" />
        <rect className="re-llave-metal" x="0.2" y="8.3" width="6.8" height="3.3" rx="1.4" />
        <rect className="re-llave-brillo" x="12.5" y="5.2" width="12" height="1" />
      </svg>
      <Golpe className="re-golpe re-golpe-1" />
      <Golpe className="re-golpe re-golpe-2" />
    </>
  );
}

function Golpe({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 10 10">
      <polygon points="5,0 6.2,3.6 10,5 6.2,6.4 5,10 3.8,6.4 0,5 3.8,3.6" fill="#FFE066" stroke="#F59E0B" strokeWidth=".6" />
    </svg>
  );
}

function Despertador() {
  return (
    <svg className="re-despertador" viewBox="0 0 24 24">
      <g className="re-timbre" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round">
        <path d="M1 6 L-3 3" />
        <path d="M0 12 L-4 12" />
        <path d="M23 6 L27 3" />
        <path d="M24 12 L28 12" />
      </g>
      <circle cx="6" cy="5" r="3.6" fill="#E5484D" />
      <circle cx="18" cy="5" r="3.6" fill="#E5484D" />
      <path d="M7 21 L5 23.5 M17 21 L19 23.5" stroke="#B4373B" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="13.5" r="8.5" fill="#E5484D" />
      <circle cx="12" cy="13.5" r="6.3" fill="#FFFFFF" />
      <path d="M12 13.5 V9.5 M12 13.5 H15" stroke="#22303F" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Avioncito() {
  return (
    <svg className="re-avioncito" viewBox="0 0 20 14">
      <path d="M0.5 6.2 L19.5 0.5 L12 13.5 L9 8.2 Z" fill="#FFFFFF" stroke="#0A559A" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 8.2 L19.5 0.5" stroke="#0A559A" strokeWidth="1.1" />
    </svg>
  );
}

/** Taza de café humeante (naranja de la marca), con el asa hacia afuera. */
function Taza() {
  return (
    <svg className="re-taza" viewBox="0 0 24 28">
      <g className="re-vapor" fill="none" stroke="#7D8A97" strokeWidth="2.6" strokeLinecap="round">
        <path pathLength={1} d="M5 11 q-2.5 -3 0 -5.5 q2.5 -2.5 0 -5" />
        <path pathLength={1} d="M12 11 q-2.5 -3 0 -5.5 q2.5 -2.5 0 -5" />
      </g>
      <rect x="1" y="12" width="15" height="15" rx="3" fill="#DE8C11" stroke="#A8650A" strokeWidth="1.4" />
      <rect x="1" y="16" width="15" height="3" fill="#FFFFFF" opacity="0.85" />
      <path d="M16 15.5 q6 0 6 5 q0 5 -6 5" fill="none" stroke="#A8650A" strokeWidth="2.4" />
    </svg>
  );
}
