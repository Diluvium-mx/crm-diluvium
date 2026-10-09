// Cuándo juega una escena la píldora 🤖 del seguimiento (9-oct-2026, prototipos aprobados por el dueño): se compara
// cómo se veía la píldora antes y cómo se ve ahora, con el chat abierto. Lo ve todo el que tenga el chat abierto,
// vendedor o admin, lo haya hecho él u otro; al abrir un chat no se juega nada. El dibujo está en robot-escena.tsx y
// los tiempos en app/globals.css › "Robot del seguimiento" (deben ser los mismos de ESCENA_MS).
// Casi inmediata (9-oct-2026, pedido del dueño: tardaba 1–2 s en arrancar): los botones de la ventana ANTICIPAN cómo
// quedará la píldora y la escena arranca al presionar; el servidor solo confirma (si dice que no, la píldora regresa
// sin escena). Reactivar no se puede anticipar (queda programado o dormido según el chat): la llave entra y golpea al
// instante, el robot se queda «cargando» hasta que llega la respuesta y entonces juega el final que toque.

export type RobotFace = "normal" | "dormido" | "cancelado";

export type Escena = "disparo" | "reparacion-golpes" | "reparacion" | "reparacion-dormido" | "reloj" | "despertador" | "avion";

/** Lo que dura cada escena (lo mismo que `--re-d` en globals.css). En «reparacion-golpes» es lo mínimo: después el
 * robot sigue «cargando» hasta que se sabe el final. */
export const ESCENA_MS: Readonly<Record<Escena, number>> = {
  disparo: 1900,
  "reparacion-golpes": 1010,
  reparacion: 1190,
  "reparacion-dormido": 1190,
  reloj: 1500,
  despertador: 2000,
  avion: 1800,
};

/** Escenas en que la píldora cambia de color: hasta este momento conserva el color de antes. */
export const ESCENA_TONO_MS: Readonly<Partial<Record<Escena, number>>> = {
  reparacion: 750,
  "reparacion-dormido": 750,
  despertador: 1240,
};

/** Si el servidor nunca contesta a Reactivar, el robot deja de «cargar» a los 15 s. */
export const GOLPES_ESPERA_MAX_MS = 15_000;

/** Lo que importa de la píldora para decidir la escena y para dibujarla. */
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
 *   Siempre van después de «reparacion-golpes» (siguienteEscena).
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

/** Lo que recibe la píldora: cómo se ve (real o anticipada), si se está reactivando y el contador de «regresar sin
 * escena» (sube cuando el servidor rechaza lo anticipado). */
export type EntradaPildora = { foto: FotoPildora; reparando: boolean; silencio: number };

export type EscenaEnCurso = {
  escena: Escena;
  /** Sube con cada escena nueva (llave de React: vuelve a empezar las animaciones). */
  n: number;
  /** Etiqueta que se va (reloj y avión). */
  etiquetaAntes: string | null;
  /** Color que conserva hasta ESCENA_TONO_MS. */
  tonoAntes: string | null;
  /** Cómo se ve la píldora mientras golpea la llave (como estaba: Cancelado). */
  vista: FotoPildora | null;
  /** El final que toca cuando terminan los golpes (null = esperando la respuesta). */
  siguiente: Escena | null;
};

/** Qué escena corre después de un cambio de la píldora (la misma referencia si no cambia nada). */
export function siguienteEscena(antes: EntradaPildora, ahora: EntradaPildora, enCurso: EscenaEnCurso | null): EscenaEnCurso | null {
  if (antes.silencio !== ahora.silencio) return null;
  const n = (enCurso?.n ?? 0) + 1;
  const golpes = enCurso?.escena === "reparacion-golpes" ? enCurso : null;
  if (ahora.reparando && !antes.reparando && !golpes) {
    return { escena: "reparacion-golpes", n, etiquetaAntes: null, tonoAntes: null, vista: ahora.foto, siguiente: null };
  }
  const escena = elegirEscena(antes.foto, ahora.foto);
  if (escena === "reparacion" || escena === "reparacion-dormido") {
    if (golpes) return { ...golpes, siguiente: escena };
    return { escena: "reparacion-golpes", n, etiquetaAntes: null, tonoAntes: null, vista: antes.foto, siguiente: escena };
  }
  if (escena) {
    return { escena, n, etiquetaAntes: antes.foto.etiqueta, tonoAntes: ESCENA_TONO_MS[escena] === undefined ? null : antes.foto.tono, vista: null, siguiente: null };
  }
  if (golpes) return ahora.foto.estado === "cancelado" ? golpes : null;
  return antes.foto.estado === ahora.foto.estado ? enCurso : null;
}

/** Al terminar los golpes: el final que tocaba, con el color de antes hasta su cambio. */
export function finDeGolpes(golpes: EscenaEnCurso): EscenaEnCurso | null {
  if (!golpes.siguiente) return null;
  return { escena: golpes.siguiente, n: golpes.n + 1, etiquetaAntes: null, tonoAntes: golpes.vista?.tono ?? null, vista: null, siguiente: null };
}

/** Cómo se dibuja la píldora mientras corre la escena. */
export function vistaDe(foto: FotoPildora, enCurso: EscenaEnCurso | null): FotoPildora {
  if (enCurso?.vista) return enCurso.vista;
  return enCurso?.tonoAntes ? { ...foto, tono: enCurso.tonoAntes } : foto;
}
