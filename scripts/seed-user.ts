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
import { auth } from "@/lib/auth";

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

  const existing = await ctx.internalAdapter.findUserByEmail(normalizedEmail);
  if (existing) {
    console.log(`Ya existe un usuario con ${normalizedEmail} — nada que hacer.`);
    return;
  }

  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  if (password.length < minPasswordLength || password.length > maxPasswordLength) {
    throw new Error(
      `SEED_USER_PASSWORD debe medir entre ${minPasswordLength} y ${maxPasswordLength} caracteres.`,
    );
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
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
