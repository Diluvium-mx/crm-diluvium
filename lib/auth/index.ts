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

  // Limiter de fábrica APAGADO en todas las rutas. Sin trustedProxies,
  // getIPFromHeader (@better-auth/core/dist/utils/ip.mjs) devuelve null en
  // cuanto x-forwarded-for trae más de un salto (lo normal en Railway), y
  // entonces TODOS los usuarios caen en el bucket compartido "no-trusted-ip":
  // un bloqueo global, no un límite por IP. Railway no publica el CIDR de sus
  // proxies, así que trustedProxies no se puede configurar con garantías.
  //
  // El límite por IP lo pone lib/rate-limit (Redis, ventana deslizante) en
  // app/api/auth/[...all]/route.ts, antes de Better Auth. El candado por
  // email (lib/auth/email-lockout.ts) sigue igual en /sign-in/email.
  //
  // `storage: "database"` se conserva aunque `enabled` sea false: es lo que
  // mantiene la tabla `rateLimit` en el schema de Better Auth
  // (@better-auth/core/dist/db/get-tables.mjs), y el candado por email
  // escribe en esa tabla.
  rateLimit: {
    enabled: false,
    storage: "database",
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
