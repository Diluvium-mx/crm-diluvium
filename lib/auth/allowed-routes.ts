// Las ÚNICAS rutas de Better Auth que se atienden por HTTP (S3, revisión de
// seguridad CN-009, 30-sep-2026). El navegador solo usa entrar, salir y revisar
// la sesión (lib/auth/client.ts); todo lo demás (crear vendedores, desactivar,
// cambiar contraseña, organización) se hace en el SERVIDOR con auth.api.*, que no
// pasa por este handler. Antes quedaban ~40 rutas abiertas: un vendedor podía leer
// los correos del equipo o renombrarse, y un admin sacar a alguien sin rastro.
const ALLOWED = new Set(["POST /api/auth/sign-in/email", "POST /api/auth/sign-out", "GET /api/auth/get-session"]);

/** Misma normalización que el limiter (mayúsculas, barras repetidas y barra final). */
export function isAllowedAuthRoute(req: Request): boolean {
  const path = new URL(req.url).pathname
    .toLowerCase()
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  return ALLOWED.has(`${req.method} ${path}`);
}
