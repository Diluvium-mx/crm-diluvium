import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { db } from "@/lib/db";
import { emailLockoutAfter, emailLockoutBefore } from "@/lib/auth/email-lockout";
import { ac, admin, agent, owner } from "@/lib/auth/permissions";

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

  // El límite de IP de fábrica (3/10s, node_modules/better-auth/dist/api/
  // rate-limiter/index.mjs: getDefaultSpecialRules) corre a nivel de router,
  // ANTES que cualquier hook — sin trustedProxies configurado para Railway,
  // colapsa en el bucket compartido "no-trusted-ip" y bloquea a todos los
  // usuarios antes de que el candado por email (lib/auth/email-lockout.ts)
  // llegue a ejecutarse. Suavizar esa regla no alcanza: sigue siendo un
  // segundo punto de bloqueo global mientras Railway no entregue una IP de
  // cliente confiable. Se desactiva por completo en esta ruta —
  // `false` en customRules apaga la regla para ese path
  // (node_modules/@better-auth/core/src/types/init-options.ts:262-278) — y
  // el candado por email queda como ÚNICA capa de rate limiting en Fase 1.
  // `storage: "database"` sigue activo para el resto de rutas (Postgres, no
  // Redis) y es la misma tabla `rateLimit` que usa el candado por email.
  rateLimit: {
    storage: "database",
    customRules: {
      "/sign-in/email": false,
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

  plugins: [
    // Roles owner/admin/agent y permisos por recurso vienen de
    // lib/auth/permissions.ts (createAccessControl). creatorRole por
    // defecto es "owner" (node_modules/better-auth/dist/plugins/
    // organization/types.d.mts:41), consistente con CLAUDE.md §5.
    // sendInvitationEmail queda sin configurar: no hay proveedor de correo
    // en el repo todavía, así que por ahora el link de invitación
    // (/accept-invitation?id=<invitation.id>) se comparte a mano.
    organization({ ac, roles: { owner, admin, agent } }),
    nextCookies(),
  ],
});
