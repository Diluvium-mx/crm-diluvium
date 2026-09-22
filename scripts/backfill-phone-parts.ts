// Uso: npx tsx scripts/backfill-phone-parts.ts            (simulación: solo cuenta)
//      npx tsx scripts/backfill-phone-parts.ts --apply    (escribe)
//
// Re-normaliza los teléfonos de `contacts` con lib/phone.ts (libphonenumber-js)
// y llena phone_country_code / phone_national / phone_country_iso. Reglas:
// - México: +521 + 10 dígitos → +52 + 10 dígitos (el único formato del CRM).
//   Si ese +52 ya lo tiene OTRO contacto de la organización, NO se cambia el
//   teléfono (sería un duplicado nuevo): se reporta para la fusión manual.
// - Un teléfono que libphonenumber no reconoce (p. ej. Brasil viejo) se queda
//   igual; solo se llenan las partes que se puedan deducir.
// - `country` vacío → se deduce del teléfono ("Mexico"); nunca se sobrescribe.
// Idempotente: una segunda corrida no encuentra nada que cambiar.
// Primero staging; en producción solo con OK del dueño.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { countryFromPhone, normalizePhone, phoneParts } from "@/lib/phone";

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await db
    .select({
      id: contacts.id,
      organizationId: contacts.organizationId,
      phoneE164: contacts.phoneE164,
      phoneCountryCode: contacts.phoneCountryCode,
      phoneNational: contacts.phoneNational,
      phoneCountryIso: contacts.phoneCountryIso,
      country: contacts.country,
    })
    .from(contacts);

  const taken = new Set(rows.filter((r) => r.phoneE164).map((r) => `${r.organizationId}|${r.phoneE164}`));
  const stats = { total: rows.length, sinTelefono: 0, telefonoCorregido: 0, choqueNoCorregido: 0, partes: 0, pais: 0, sinCambios: 0 };
  const collisions: string[] = [];
  const updates: { id: string; set: Partial<typeof contacts.$inferInsert> }[] = [];

  for (const row of rows) {
    if (!row.phoneE164) {
      stats.sinTelefono++;
      continue;
    }
    let phone = row.phoneE164;
    try {
      phone = normalizePhone(row.phoneE164);
    } catch {
      // Forma no E.164: se deja igual (limpieza manual).
    }
    const set: Partial<typeof contacts.$inferInsert> = {};
    if (phone !== row.phoneE164) {
      if (taken.has(`${row.organizationId}|${phone}`)) {
        stats.choqueNoCorregido++;
        collisions.push(`${row.id}: ${row.phoneE164} → ${phone} ya existe en otro contacto`);
        phone = row.phoneE164;
      } else {
        set.phoneE164 = phone;
        taken.delete(`${row.organizationId}|${row.phoneE164}`);
        taken.add(`${row.organizationId}|${phone}`);
        stats.telefonoCorregido++;
      }
    }
    const parts = phoneParts(phone);
    if (
      parts.phoneCountryCode !== row.phoneCountryCode ||
      parts.phoneNational !== row.phoneNational ||
      parts.phoneCountryIso !== row.phoneCountryIso
    ) {
      Object.assign(set, parts);
      stats.partes++;
    }
    if (!row.country?.trim()) {
      const country = countryFromPhone(phone);
      if (country) {
        set.country = country;
        stats.pais++;
      }
    }
    if (Object.keys(set).length === 0) stats.sinCambios++;
    else updates.push({ id: row.id, set });
  }

  console.log(JSON.stringify(stats, null, 2));
  for (const line of collisions) console.warn(`CHOQUE: ${line}`);

  if (!apply) {
    console.log(`Simulación: ${updates.length} contacto(s) cambiarían. Corre con --apply para escribir.`);
    process.exit(0);
  }
  await db.transaction(async (tx) => {
    for (const { id, set } of updates) await tx.update(contacts).set(set).where(eq(contacts.id, id));
  });
  console.log(`${updates.length} contacto(s) actualizados.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
