import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins/admin";
import { organization } from "better-auth/plugins/organization";
import { db } from "@/lib/db";
import { emailLockoutAfter, emailLockoutBefore } from "@/lib/auth/email-lockout";
import { seedDefaultSizeRanges } from "@/lib/contacts/sizes-seed";
import { seedDefaultWorkflows } from "@/lib/workflows/seed";
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
    // Sin caché de sesión en cookie (antes 60 s): al DESACTIVAR a un vendedor
    // (A4) se borran sus sesiones y debe perder el acceso al instante en TODO
    // (páginas, /api/media, SSE y los endpoints /organization/* de Better Auth).
    // Con la caché, esa cookie seguía valiendo hasta 60 s. A esta escala, una
    // consulta de sesión por request es despreciable.
    cookieCache: { enabled: false },
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
    // disableOrganizationDeletion: en v1 no se borran organizaciones (CLAUDE.md
    // §5: "desactivar" un miembro es borrar su fila de member; los seeds de
    // producción no se borran). Además, borrar una organización dejaría su
    // media en el bucket (ObjectStorage no expone delete todavía): hasta tener
    // una limpieza durable del almacenamiento, el borrado queda cerrado.
    organization({
      ac,
      roles: { owner, admin, agent },
      disableOrganizationDeletion: true,
      // Nadie crea organizaciones por HTTP (/api/auth/organization/create): el
      // CRM es de UNA organización (Diluvium). Si un vendedor pudiera crear otra,
      // quedaría como su único owner y el trigger de "≥1 owner activo" (0021)
      // impediría desactivarlo. Las llamadas de SERVIDOR con userId (seed-org)
      // siguen permitidas (dist/plugins/organization/routes/crud-org.mjs:56-58).
      allowUserToCreateOrganization: false,
      // Toda organización nueva nace con los rangos de tallas por defecto (A7)
      // y con los workflows predeterminados apagados (Fase D).
      organizationHooks: {
        afterCreateOrganization: async ({ organization: created }) => {
          await seedDefaultSizeRanges(db, created.id);
          await seedDefaultWorkflows(db, created.id);
        },
      },
    }),
    // Plugin admin: SOLO para crear usuarios desde el servidor y para el campo
    // `banned` (desactivar), cuyo hook bloquea el inicio de sesión
    // (dist/plugins/admin/admin.mjs:30-45). Nunca para roles: su user.role
    // global no se usa (el rol vive en member.role). Sus endpoints HTTP
    // /admin/* quedan cerrados porque nadie tiene rol global "admin".
    adminPlugin({ bannedUserMessage: "Tu usuario está desactivado. Pide a un administrador que lo reactive." }),
    nextCookies(),
  ],
});
