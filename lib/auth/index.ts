import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { emailLockoutAfter, emailLockoutBefore } from "@/lib/auth/email-lockout";

if (!process.env.APP_URL) {
  throw new Error("APP_URL is not set");
}

const isProd = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  baseURL: process.env.APP_URL,
  // transaction: true — sin esto, drizzleAdapter no da atomicidad SQL real:
  // cae al fallback createAsIsTransaction (solo fn(adapter), sin BEGIN/COMMIT)
  // y runWithTransaction() se vuelve un no-op. Necesario para que
  // scripts/seed-user.ts (y el propio /sign-up/email) sean todo-o-nada.
  database: drizzleAdapter(db, { provider: "pg", transaction: true }),

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,        // registro público CERRADO — solo por invitación
    minPasswordLength: 12,
    autoSignIn: false,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,   // 7 días
    updateAge: 60 * 60 * 24,       // refresco diario
    storeSessionInDatabase: true,  // sesión durable en Postgres, no solo Redis
    cookieCache: { enabled: true, maxAge: 60 },
  },

  // Capa PRINCIPAL contra fuerza bruta: límite por email en lib/auth/email-lockout.ts
  // (5 fallos/300s por cuenta). Este bloque es la capa SECUNDARIA por IP — se
  // guarda en Postgres (no Redis) y se suaviza solo en /sign-in/email
  // (30/300s) para que sea el email, no el IP compartido, el que se dispare
  // primero en un ataque a una cuenta. Sin este customRule, la regla especial
  // de fábrica (3/10s, node_modules/better-auth/dist/api/rate-limiter/index.mjs:
  // getDefaultSpecialRules) corre ANTES que cualquier hook y podía tumbar a
  // todos los usuarios por un IP sin resolver — el hallazgo que cerramos aquí.
  rateLimit: {
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 300, max: 30 },
    },
  },

  trustedOrigins: [process.env.APP_URL],

  advanced: {
    cookiePrefix: "diluvium",
    useSecureCookies: isProd,
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },

  hooks: {
    before: emailLockoutBefore,
    after: emailLockoutAfter,
  },

  plugins: [nextCookies()],        // el plugin organization entra en el PR 1.2
});
