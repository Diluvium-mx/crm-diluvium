// Avisos de «Iniciar sesión» que llegan por `?aviso=`: después de cambiar la contraseña en
// «Mi cuenta» se cierran todas las sesiones y la pantalla de entrada explica por qué
// (decisión del dueño, 27-oct-2026). Solo una palabra fija en la URL, nunca datos del usuario.
export const SIGN_IN_NOTICES = {
  contrasena: "Tu contraseña cambió y se cerraron tus sesiones. Entra con tu correo y la contraseña nueva.",
} as const;

export type SignInNotice = keyof typeof SIGN_IN_NOTICES;

export function signInNoticeHref(notice: SignInNotice): string {
  return `/sign-in?aviso=${notice}`;
}

export function signInNoticeText(value: string | null): string | null {
  return value !== null && Object.hasOwn(SIGN_IN_NOTICES, value) ? SIGN_IN_NOTICES[value as SignInNotice] : null;
}
