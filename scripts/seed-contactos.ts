// Uso: npx tsx scripts/seed-contactos.ts
// Siembra ~40 contactos falsos en la organización existente, repartidos
// entre las 5 etapas de contact_stage. Pensado para poblar Fase 1 antes de
// tener datos reales (CLAUDE.md §10.6: "no sobre-blindar Fase 1 con datos
// falsos y 2 usuarios" — esto es justo ese dato falso mínimo para probar
// la pantalla de Contactos con volumen real de fila).
//
// A diferencia de scripts/seed-user.ts, contacts no es una tabla que
// better-auth administre: no hay createUser/linkAccount ni lógica de
// auth.$context que reutilizar para ella. seed-user.ts pasa por
// auth.$context solo para el hash de password y el linkAccount
// transaccional del propio better-auth; para organization/member/user
// (lectura) y contacts (escritura) basta con el mismo `db` de Drizzle que
// usa lib/actions/contacts.ts, así que este script se conecta igual que
// esas Server Actions: import { db } from "@/lib/db".
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { member, organization, user } from "@/lib/db/schema/auth";
import { contacts, contactStageEnum } from "@/lib/db/schema/contacts";
import { normalizePhone } from "@/lib/phone";

const SEED_SOURCE = "seed";
const CONTACTS_PER_STAGE = 8; // 8 × 5 etapas = 40 contactos

const FIRST_NAMES = [
  "María", "José", "Juan", "Guadalupe", "Alejandro", "Fernanda", "Luis", "Ana",
  "Carlos", "Daniela", "Miguel", "Sofía", "Jorge", "Valeria", "Ricardo", "Camila",
  "Javier", "Paola", "Roberto", "Ximena",
] as const;

const LAST_NAMES = [
  "García", "Hernández", "Martínez", "López", "González", "Pérez", "Rodríguez",
  "Sánchez", "Ramírez", "Flores", "Torres", "Vázquez", "Gómez", "Ruiz", "Díaz",
  "Morales", "Reyes", "Cruz", "Ortiz", "Mendoza",
] as const;

const EMAIL_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com"] as const;

// Códigos de área reales: 2 dígitos para las 3 zonas metropolitanas más
// grandes (número local de 8 dígitos), 3 dígitos para el resto (número
// local de 7 dígitos) — en ambos casos el número nacional suma 10 dígitos,
// como en el plan de numeración mexicano real.
const AREA_CODES = ["55", "33", "81", "656", "998", "999", "442", "477", "222", "614"] as const;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomDigits(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function slugify(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function randomMexicanPhone(usedPhones: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const areaCode = pick(AREA_CODES);
    const localLength = 10 - areaCode.length;
    const raw = `+52${areaCode}${randomDigits(localLength)}`;
    // Pasa por la única función de normalización del proyecto (CLAUDE.md
    // §5) en vez de asumir que lo que se acaba de construir ya es E.164
    // válido.
    const phoneE164 = normalizePhone(raw);

    if (!usedPhones.has(phoneE164)) {
      usedPhones.add(phoneE164);
      return phoneE164;
    }
  }

  throw new Error("No se pudo generar un teléfono único tras 50 intentos.");
}

function generateFakeContact(
  stage: (typeof contactStageEnum.enumValues)[number],
  usedPhones: Set<string>,
) {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const email = `${slugify(firstName)}.${slugify(lastName)}${Math.floor(Math.random() * 1000)}@${pick(EMAIL_DOMAINS)}`;

  return {
    id: crypto.randomUUID(),
    firstName,
    lastName,
    phoneE164: randomMexicanPhone(usedPhones),
    email,
    ghlContactId: null,
    source: SEED_SOURCE,
    stage,
  };
}

// "buscar la única org, o la del owner contacto@diluvium.com.mx": el owner
// es la ancla determinista (por si algún día hay más de una organización);
// "única org" es el atajo válido para el caso normal de Fase 1, donde ese
// owner es justo el que se sembró con seed-user.ts.
async function resolveOrganizationId(): Promise<string> {
  const ownerEmail = process.env.SEED_CONTACTS_OWNER_EMAIL ?? "contacto@diluvium.com.mx";

  const [ownerUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, ownerEmail));

  if (ownerUser) {
    const [ownerMembership] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, ownerUser.id), eq(member.role, "owner")));

    if (ownerMembership) {
      return ownerMembership.organizationId;
    }
  }

  const organizations = await db.select({ id: organization.id }).from(organization);

  if (organizations.length === 1) {
    return organizations[0].id;
  }

  if (organizations.length === 0) {
    throw new Error("No hay ninguna organización en la base de datos todavía.");
  }

  throw new Error(
    `Hay ${organizations.length} organizaciones y no se encontró al owner "${ownerEmail}" ` +
      "con membresía role=owner para desambiguar. Define SEED_CONTACTS_OWNER_EMAIL o revisa la tabla member.",
  );
}

async function main() {
  const organizationId = await resolveOrganizationId();

  await db.transaction(async (tx) => {
    const [existingSeed] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.source, SEED_SOURCE)))
      .limit(1);

    if (existingSeed) {
      console.log(
        `Ya hay contactos con source="${SEED_SOURCE}" en la organización ${organizationId} — nada que hacer.`,
      );
      return;
    }

    const usedPhones = new Set<string>();
    const rows = contactStageEnum.enumValues.flatMap((stage) =>
      Array.from({ length: CONTACTS_PER_STAGE }, () => ({
        ...generateFakeContact(stage, usedPhones),
        organizationId,
      })),
    );

    await tx.insert(contacts).values(rows);

    console.log(
      `Sembrados ${rows.length} contactos falsos (source="${SEED_SOURCE}") en la organización ${organizationId}.`,
    );
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
