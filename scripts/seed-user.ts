// Uso: npx tsx scripts/seed-user.ts
// Crea el primer usuario (email/password) sin pasar por /sign-up/email, que
// está cerrado (emailAndPassword.disableSignUp: true en lib/auth/index.ts).
//
// auth.api.signUpEmail() no sirve para esto: el chequeo de disableSignUp vive
// dentro del propio endpoint (node_modules/better-auth/dist/api/routes/sign-up.mjs),
// así que se dispara igual llamado desde el servidor. En vez de eso, este
// script reproduce exactamente lo que ese endpoint hace internamente —
// ctx.password.hash() + internalAdapter.createUser() + internalAdapter.linkAccount()
// con providerId: "credential" — usando auth.$context, la vía pública y
// tipada para llegar al AuthContext fuera de un request
// (node_modules/better-auth/dist/types/auth.d.mts: `$context: Promise<AuthContext<Options> & ...>`).
//
// Todo el paso — chequeo de existencia, createUser y linkAccount — corre
// dentro de runWithTransaction, la misma envoltura que usa el propio
// sign-up.mjs (`runWithTransaction(ctx.context.adapter, async () => {...})`).
// internalAdapter resuelve su adapter en cada llamada vía
// getCurrentAdapter(adapter) (node_modules/better-auth/dist/db/internal-adapter.mjs),
// que lee de la misma AsyncLocalStorage que runWithTransaction llena — por
// eso basta con envolver la función, sin pasar la transacción a mano. Esto
// funciona con drizzleAdapter porque DBAdapter.transaction() es parte del
// contrato de adapter que better-auth exige de cualquier adapter, Drizzle
// incluido (node_modules/@better-auth/core/dist/db/adapter.d.mts).
//
// Idempotente por credential account, no por fila de usuario: si el usuario
// ya existe pero un corte a medias dejó la cuenta sin linkAccount, este
// script completa el linkAccount en vez de darlo por hecho.
import { auth } from "@/lib/auth";
import { runWithTransaction } from "@better-auth/core/context";

async function main() {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  const name = process.env.SEED_USER_NAME ?? "Admin";

  if (!email || !password) {
    throw new Error(
      "SEED_USER_EMAIL y SEED_USER_PASSWORD son obligatorias (env vars, no hardcodear).",
    );
  }

  const ctx = await auth.$context;
  const normalizedEmail = email.toLowerCase();

  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  if (password.length < minPasswordLength || password.length > maxPasswordLength) {
    throw new Error(
      `SEED_USER_PASSWORD debe medir entre ${minPasswordLength} y ${maxPasswordLength} caracteres.`,
    );
  }

  await runWithTransaction(ctx.adapter, async () => {
    const existing = await ctx.internalAdapter.findUserByEmail(normalizedEmail);

    if (existing) {
      const credential = await ctx.internalAdapter.findCredentialAccount(
        existing.user.id,
      );
      if (credential) {
        console.log(
          `Ya existe ${normalizedEmail} con credential account — nada que hacer.`,
        );
        return;
      }

      // Fila de usuario sin credential account: un corte previo dejó el
      // seed a medias. Completa el linkAccount en vez de tratarlo como éxito.
      const hash = await ctx.password.hash(password);
      await ctx.internalAdapter.linkAccount({
        userId: existing.user.id,
        providerId: "credential",
        accountId: existing.user.id,
        password: hash,
      });
      console.log(
        `Completada la credential account faltante de ${normalizedEmail} (id ${existing.user.id}).`,
      );
      return;
    }

    const hash = await ctx.password.hash(password);
    const user = await ctx.internalAdapter.createUser(
      { email: normalizedEmail, name, emailVerified: true },
      { method: "email-password" },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hash,
    });
    console.log(`Usuario creado: ${normalizedEmail} (id ${user.id})`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
