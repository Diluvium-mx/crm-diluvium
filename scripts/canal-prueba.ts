// Uso: npm run canal:prueba -- --cuenta <accountId> [--nombre "Número de prueba"] [--telefono +52…] [--org <id>] [--confirmar]
// Da de alta (o marca) un canal de WhatsApp de PRUEBA (docs/numero-prueba.md):
// - si la cuenta ya tiene canal, lo marca is_test (y actualiza nombre/teléfono si se pasan);
// - si no, lo crea activo, marcado Prueba y con el agente APAGADO (se enciende después
//   desde la pestaña Agente IA, para que lo copiado antes no se conteste solo);
// - marca "Prueba" a los contactos que solo hablan por canales de prueba.
// Sin --confirmar solo muestra lo que haría. Nunca borra nada.
import { parseArgs } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, member } from "@/lib/db/schema";
import { normalizePhone } from "@/lib/phone";

async function main() {
  const { values } = parseArgs({
    options: {
      cuenta: { type: "string" },
      nombre: { type: "string" },
      telefono: { type: "string" },
      org: { type: "string" },
      confirmar: { type: "boolean", default: false },
    },
  });
  const accountId = values.cuenta?.trim();
  if (!accountId || !/^[A-Za-z0-9_-]{6,64}$/.test(accountId)) throw new Error("--cuenta <accountId de Zernio> es obligatorio");
  const phone = values.telefono ? normalizePhone(values.telefono) : null;

  const [existing] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.provider, "zernio"), eq(channels.providerAccountId, accountId)))
    .limit(1);

  let organizationId = values.org ?? existing?.organizationId;
  if (!organizationId) {
    // Una sola organización en producción: se toma la del owner si no se indica.
    const orgs = await db.selectDistinct({ id: member.organizationId }).from(member).where(eq(member.role, "owner"));
    if (orgs.length !== 1) throw new Error(`Hay ${orgs.length} organizaciones con owner: indica --org`);
    organizationId = orgs[0].id;
  }

  if (existing) {
    console.log(`Canal existente ${existing.id} (${existing.displayName}): is_test ${existing.isTest} → true` +
      (values.nombre ? `, nombre → ${values.nombre}` : "") + (phone ? `, teléfono → ${phone}` : ""));
  } else {
    console.log(`Canal NUEVO para la cuenta ${accountId} en la organización ${organizationId}: "${values.nombre ?? "Número de prueba"}", ` +
      `${phone ?? "sin teléfono"}, marcado Prueba, activo, agente apagado`);
  }
  if (!values.confirmar) {
    console.log("Simulación: no se cambió nada. Repite con --confirmar para aplicarlo.");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(channels)
        .set({ isTest: true, ...(values.nombre ? { displayName: values.nombre } : {}), ...(phone ? { phoneE164: phone } : {}) })
        .where(eq(channels.id, existing.id));
    } else {
      await tx.insert(channels).values({
        id: `ch_zernio_${accountId}`,
        organizationId: organizationId!,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: accountId,
        displayName: values.nombre ?? "Número de prueba",
        phoneE164: phone,
        isActive: true,
        isTest: true,
        aiAgentMode: "off",
      });
    }
    // Contactos que solo hablan por canales de prueba → Prueba.
    const marked = await tx.execute<{ id: string }>(sql`
      update contacts c set es_prueba = true
       where c.organization_id = ${organizationId} and not c.es_prueba
         and exists (select 1 from conversations cv join channels ch on ch.id = cv.channel_id
                      where cv.contact_id = c.id and ch.is_test)
         and not exists (select 1 from conversations cv join channels ch on ch.id = cv.channel_id
                          where cv.contact_id = c.id and not ch.is_test)
      returning c.id`);
    console.log(`Listo. Contactos marcados Prueba ahora: ${marked.length}.`);
  });
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
