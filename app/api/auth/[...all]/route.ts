import { auth } from "@/lib/auth";
import { isAllowedAuthRoute } from "@/lib/auth/allowed-routes";
import { authRateLimitRules, ipRateLimiter, withRateLimit } from "@/lib/rate-limit";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);

// S3 (CN-009): solo entrar, salir y revisar la sesión; lo demás no existe por HTTP.
const onlyAllowed =
  (handler: (req: Request) => Promise<Response>) =>
  (req: Request): Promise<Response> =>
    isAllowedAuthRoute(req) ? handler(req) : Promise.resolve(new Response("no encontrado", { status: 404 }));

// Rate limit por IP antes de Better Auth (su limiter de fábrica está
// desactivado, ver lib/auth/index.ts).
export const GET = withRateLimit(ipRateLimiter, authRateLimitRules, onlyAllowed(handlers.GET));
export const POST = withRateLimit(ipRateLimiter, authRateLimitRules, onlyAllowed(handlers.POST));
