import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";

if (!process.env.APP_URL) {
  throw new Error("APP_URL is not set");
}

const isProd = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  baseURL: process.env.APP_URL,
  database: drizzleAdapter(db, { provider: "pg" }),

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

  trustedOrigins: [process.env.APP_URL],

  advanced: {
    cookiePrefix: "diluvium",
    useSecureCookies: isProd,
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },

  plugins: [nextCookies()],        // el plugin organization entra en el PR 1.2
});
