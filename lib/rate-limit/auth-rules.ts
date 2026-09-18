import type { RateLimitConfig } from "./config";
import type { RateLimitRule } from "./limiter";

const SIGN_IN_EMAIL_PATH = "/api/auth/sign-in/email";

/** Reglas para app/api/auth/[...all]: general + estricta en sign-in. */
export function authRateLimitRules(
  config: Pick<RateLimitConfig, "auth" | "signIn">,
): (req: Request) => readonly RateLimitRule[] {
  return (req) => (isSignInEmail(req) ? [config.auth, config.signIn] : [config.auth]);
}

// Normaliza mayúsculas, barras repetidas y barra final para que
// `/api/auth//Sign-In/email/` no esquive la regla estricta.
export function isSignInEmail(req: Request): boolean {
  const path = new URL(req.url).pathname
    .toLowerCase()
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  return path === SIGN_IN_EMAIL_PATH;
}
