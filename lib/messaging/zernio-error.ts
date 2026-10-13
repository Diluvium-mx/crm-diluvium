// El motivo de un error de Zernio, en el texto que se le enseña al vendedor (12-oct-2026). PURO.
// Zernio usa un sobre único (docs.zernio.com/guides/error-handling): `error` es el TEXTO legible (no un objeto),
// `code` va al mismo nivel y, si lo rechazó la plataforma, `platformError` trae lo que dijo Meta tal cual
// (`error_user_title`, `error_user_msg`, a veces dentro de `error`). Antes solo se leía `error.message` y todo
// rechazo salía como «Zernio respondió 400» (p. ej. el nombre de una plantilla borrada, bloqueado unas 4 semanas).
// Se aceptan también las formas viejas ({ error: { message, code } }, { message }).

const MAX_LENGTH = 500;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function rec(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export type ZernioErrorDetail = { message: string; code?: string };

/** `body` = el JSON de la respuesta (o lo que se pudo leer); `status` = el código HTTP. */
export function zernioErrorDetail(body: unknown, status: number): ZernioErrorDetail {
  const root = rec(body);
  const nested = rec(root.error);
  const base = str(root.error) ?? str(nested.message) ?? str(root.message);
  // Lo que dijo Meta: en el sobre nuevo, platformError (a veces con su propio { error: {...} }).
  const platform = rec(root.platformError);
  const meta = { ...rec(platform.error), ...platform };
  const title = str(meta.error_user_title);
  const userMsg = str(meta.error_user_msg) ?? (base ? undefined : str(meta.message));
  const metaText = [title, userMsg].filter((part) => part && !base?.includes(part)).join(": ");
  const message = [base, metaText].filter(Boolean).join(" — ") || `Zernio respondió ${status}`;
  return {
    message: message.length > MAX_LENGTH ? `${message.slice(0, MAX_LENGTH - 1)}…` : message,
    code: str(nested.code) ?? str(root.code),
  };
}
