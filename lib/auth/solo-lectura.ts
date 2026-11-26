// Rol «Solo lectura» (26-nov-2026, decisión del dueño): una persona de confianza que entra a OBSERVAR
// cómo funciona el CRM. Ve TODO lo que ve el owner (Configuración incluida) y puede presionar botones,
// pero nada se guarda ni se envía, y solo escribe en los buscadores.
//
// Tres barreras:
// 1. Servidor (la que manda): requireActiveMembership() rechaza a este rol en toda Server Action que
//    no se declare de consulta (`{ acceso: "consulta" }`) y en las rutas de API que escriben
//    (`{ acceso: "cambio" }`). Una acción nueva queda bloqueada por defecto (falla cerrado).
// 2. Navegador: components/solo-lectura/ muestra el aviso cuando el servidor rechaza algo y no deja
//    escribir fuera de los buscadores.
// 3. Better Auth por HTTP solo atiende entrar, salir y la sesión (lib/auth/allowed-routes.ts).
//
// Sin `server-only`: el navegador usa el digest y el mensaje para reconocer el rechazo.

export const SOLO_LECTURA_ROLE = "viewer";

/** Viaja en el error de la Server Action rechazada (Next conserva el digest en producción). */
export const SOLO_LECTURA_DIGEST = "SOLO_LECTURA";

export const SOLO_LECTURA_MENSAJE = "Modo solo lectura: no se guardó nada.";

/** Encabezado de las rutas de API que rechazan al rol (el navegador lo usa para el aviso). */
export const SOLO_LECTURA_HEADER = "x-solo-lectura";

/** ¿El rol (member.role, puede venir como «a,b») es de solo lectura? Si trae viewer, lo es. */
export function esSoloLectura(role: string | null | undefined): boolean {
  if (!role) return false;
  return role.split(",").some((r) => r.trim() === SOLO_LECTURA_ROLE);
}

export class SoloLecturaError extends Error {
  readonly digest = SOLO_LECTURA_DIGEST;

  constructor() {
    super(SOLO_LECTURA_MENSAJE);
    this.name = "SoloLecturaError";
  }
}

/**
 * Primera línea de todo `catch` de una Server Action: el rechazo sigue de largo hasta Next, que
 * responde con el digest y así el navegador muestra el aviso (si la acción lo atrapara y devolviera
 * su propio «No se pudo…», el aviso no saldría). Lo vigila lib/auth/solo-lectura-guard.test.ts.
 */
export function relanzarSoloLectura(error: unknown): void {
  if (error instanceof SoloLecturaError) throw error;
}

/** ¿Este error (lanzado por una Server Action) es el rechazo de solo lectura? */
export function esRechazoSoloLectura(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { digest?: unknown }).digest === SOLO_LECTURA_DIGEST;
}

/** Respuesta de una ruta de API que rechaza al rol (mismo `{ error }` que leen las subidas). */
export function respuestaSoloLectura(): Response {
  return Response.json(
    { error: SOLO_LECTURA_MENSAJE },
    { status: 403, headers: { [SOLO_LECTURA_HEADER]: "1", "Cache-Control": "no-store" } },
  );
}
