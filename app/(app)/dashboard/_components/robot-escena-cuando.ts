// Cuándo juega una escena la píldora 🤖 del seguimiento (9-oct-2026, prototipos aprobados por el dueño): se compara
// cómo se veía la píldora antes y cómo se ve ahora, con el chat abierto. Lo ve todo el que tenga el chat abierto,
// vendedor o admin, lo haya hecho él u otro; al abrir un chat no se juega nada. El dibujo está en robot-escena.tsx y
// los tiempos en app/globals.css › "Robot del seguimiento" (deben ser los mismos de ESCENA_MS).

export type RobotFace = "normal" | "dormido" | "cancelado";

export type Escena = "disparo" | "reparacion" | "reparacion-dormido" | "reloj" | "despertador" | "avion";

/** Lo que dura cada escena (lo mismo que `--re-d` en globals.css). */
export const ESCENA_MS: Readonly<Record<Escena, number>> = {
  disparo: 1900,
  reparacion: 2200,
  "reparacion-dormido": 2200,
  reloj: 1500,
  despertador: 2000,
  avion: 1800,
};

/** Escenas en que la píldora cambia de color: hasta este momento conserva el color de antes. */
export const ESCENA_TONO_MS: Readonly<Partial<Record<Escena, number>>> = {
  reparacion: 1760,
  "reparacion-dormido": 1760,
  despertador: 1240,
};

/** Lo que importa de la píldora para decidir la escena. */
export type FotoPildora = {
  estado: "activo" | "dormido" | "cancelado" | "baja";
  /** Seguimiento a la vista (solo «activo»). */
  id: string | null;
  dueAt: string | null;
  /** Mensajes que ya salieron (o se intentaron). */
  enviados: number;
  /** El último intento sí salió (sin error y fuera de ensayo). */
  ultimoSalio: boolean;
  cara: RobotFace;
  etiqueta: string | null;
  tono: string;
};

/**
 * - disparo: pasa a Cancelado (Cancelar o Apagar seguimientos en este chat).
 * - reparacion / reparacion-dormido: sale de Cancelado (Reactivar); termina despierto o dormido según la carita nueva.
 * - avion: el mismo seguimiento tiene un mensaje más y sí salió.
 * - despertador: el mismo seguimiento deja de estar suspendido (Que salga solo).
 * - reloj: el mismo seguimiento cambia de hora con el robot despierto (Cambiar hora).
 */
export function elegirEscena(antes: FotoPildora, ahora: FotoPildora): Escena | null {
  if (ahora.estado === "cancelado") return antes.estado === "cancelado" ? null : "disparo";
  if (antes.estado === "cancelado") {
    if (ahora.estado !== "activo" && ahora.estado !== "dormido") return null;
    return ahora.cara === "normal" ? "reparacion" : "reparacion-dormido";
  }
  if (antes.estado !== "activo" || ahora.estado !== "activo" || antes.id !== ahora.id) return null;
  if (ahora.enviados > antes.enviados) return ahora.ultimoSalio && ahora.cara === "normal" ? "avion" : null;
  if (antes.cara === "dormido" && ahora.cara === "normal") return "despertador";
  if (ahora.dueAt && antes.dueAt !== ahora.dueAt && antes.cara === "normal" && ahora.cara === "normal") return "reloj";
  return null;
}
