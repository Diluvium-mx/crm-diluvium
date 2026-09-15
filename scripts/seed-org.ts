// Uso: npx tsx scripts/seed-org.ts
// Crea la organización "Diluvium" y vincula al owner
// (contacto@diluvium.com.mx) como member role="owner".
//
// A diferencia de scripts/seed-contactos.ts (contacts no es una tabla de
// better-auth), `organization` y `member` sí lo son, así que el camino
// correcto es auth.api.createOrganization en vez de insertar a mano:
// - body.userId permite crear la organización a nombre de un usuario
//   específico sin sesión activa — "server-only" en la doc del schema
//   (node_modules/better-auth/dist/plugins/organization/routes/
//   crud-org.d.mts) — justo el caso de un script.
// - El propio endpoint genera el id, castea createdAt = new Date() y crea
//   la fila member con role = orgOptions.creatorRole ?? "owner" (default,
//   sin configurar en lib/auth/index.ts) en una sola llamada — confirmado
//   en crud-org.mjs. Reusarlo evita reimplementar esa lógica a mano.
// Shape real confirmado en lib/db/schema/auth.ts: organization.createdAt y
// member.createdAt son notNull SIN defaultNow() — hay que poblarlos
// explícitamente si algún día se insertara a mano (el endpoint ya lo hace).
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, organization, user } from "@/lib/db/schema/auth";

const ORG_NAME = "Diluvium";
const ORG_SLUG = "diluvium";

async function main() {
  const ownerEmail = process.env.SEED_ORG_OWNER_EMAIL ?? "contacto@diluvium.com.mx";

  const [ownerUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, ownerEmail));

  if (!ownerUser) {
    throw new Error(`No existe un usuario con email ${ownerEmail}. Corre scripts/seed-user.ts primero.`);
  }

  const [existingOrg] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, ORG_SLUG));

  if (existingOrg) {
    const [ownerMembership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, existingOrg.id),
          eq(member.userId, ownerUser.id),
          eq(member.role, "owner"),
        ),
      );

    if (ownerMembership) {
      console.log(
        `Ya existe "${ORG_SLUG}" (id ${existingOrg.id}) con ${ownerEmail} como owner — nada que hacer.`,
      );
      return;
    }

    // Corte previo dejó la organización sin su membresía owner: se
    // completa en vez de tratarlo como éxito (mismo patrón que
    // scripts/seed-user.ts con la credential account faltante).
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: existingOrg.id,
      userId: ownerUser.id,
      role: "owner",
      createdAt: new Date(),
    });

    console.log(
      `Completada la membresía owner faltante de ${ownerEmail} en "${ORG_SLUG}" (org ${existingOrg.id}).`,
    );
    return;
  }

  const created = await auth.api.createOrganization({
    body: {
      name: ORG_NAME,
      slug: ORG_SLUG,
      userId: ownerUser.id,
    },
  });

  console.log(`Organización "${ORG_NAME}" creada (id ${created.id}), owner: ${ownerEmail}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
