import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

if (!process.env.APP_URL) {
  throw new Error("APP_URL is not set");
}

const isProd = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  baseURL: process.env.APP_URL,
  database: drizzleAdapter(db, { provider: "pg" }),

  secondaryStorage: {
    get: async (key) => await redis.get(key),
    getAndDelete: async (key) => await redis.getdel(key),
    // Atomic INCR + EXPIRE-on-create, required so Redis-backed rate
    // limiting enforces the window in one distributed-safe operation.
    increment: async (key, ttl) => {
      const value = await redis.eval(
        `local v = redis.call("INCR", KEYS[1])
         if v == 1 then
           redis.call("EXPIRE", KEYS[1], ARGV[1])
         end
         return v`,
        1,
        key,
        ttl,
      );
      return Number(value);
    },
    set: async (key, value, ttl) =>
      ttl
        ? void (await redis.set(key, value, "EX", ttl))
        : void (await redis.set(key, value)),
    delete: async (key) => void (await redis.del(key)),
  },

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,        // registro público CERRADO — solo por invitación
    minPasswordLength: 12,
    autoSignIn: false,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,   // 7 días
    updateAge: 60 * 60 * 24,       // refresco diario
    cookieCache: { enabled: true, maxAge: 60 },
  },

  rateLimit: {
    enabled: true,
    storage: "secondary-storage",  // usa Redis
    window: 60,
    max: 30,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/forget-password": { window: 300, max: 3 },
    },
  },

  trustedOrigins: [process.env.APP_URL],

  advanced: {
    cookiePrefix: "diluvium",
    useSecureCookies: isProd,
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },

  plugins: [nextCookies()],        // el plugin organization entra en el PR 1.2
});
