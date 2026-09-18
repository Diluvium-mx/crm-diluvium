import { auth } from "@/lib/auth";
import { authRateLimitRules, ipRateLimiter, withRateLimit } from "@/lib/rate-limit";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);

// Rate limit por IP antes de Better Auth (su limiter de fábrica está
// desactivado, ver lib/auth/index.ts).
export const GET = withRateLimit(ipRateLimiter, authRateLimitRules, handlers.GET);
export const POST = withRateLimit(ipRateLimiter, authRateLimitRules, handlers.POST);
