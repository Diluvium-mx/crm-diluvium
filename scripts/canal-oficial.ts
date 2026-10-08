// Uso: npm run canal:oficial -- --cuenta <accountId> --conectado <ISO> [--telefono +526682419579] [--nombre "WhatsApp Diluvium"] [--org <id>] [--confirmar]
// Alta del canal del número OFICIAL (docs/go-live.md, día del número oficial):
// - canal REAL (sin marca Prueba: lo que entra cuenta en el Dashboard), activo y con el
//   agente APAGADO (se enciende en AUTO cuando el historial ya se asentó: lo copiado
//   antes nunca se contesta solo);
// - --conectado = hora de conexión en Zernio (ISO con zona): lo enviado ANTES es historial
//   del celular aunque llegue por webhook sin marca (red de seguridad, obligatorio);
// - se corre ANTES de sumar la cuenta a ZERNIO_ALLOWED_ACCOUNT_IDS (así no hay hueco).
// Si la cuenta ya tiene canal, no cambia nada y lo muestra. Sin --confirmar solo
// muestra lo que haría. Nunca borra nada.
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, member } from "@/lib/db/schema";
import { validDate } from "@/lib/messaging/zernio";
import { normalizePhone } from "@/lib/phone";
import { safeErrorMessage } from "@/lib/log/safe-error";

const OFFICIAL_PHONE = "+526682419579";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      cuenta: { type: "string" },
      conectado: { type: "string" },
      telefono: { type: "string" },
      nombre: { type: "string" },
      org: { type: "string" },
      confirmar: { type: "boolean", default: false },
    },
  });
  const accountId = values.cuenta?.trim();
  if (!accountId || !/^[A-Za-z0-9_-]{6,64}$/.test(accountId)) throw new Error("--cuenta <accountId de Zernio> es obligatorio");
  const connectedAt = values.conectado ? validDate(values.conectado) : null;
  if (!connectedAt) throw new Error("--conectado <ISO con zona> es obligatorio (hora de conexión en Zernio, p. ej. 2026-09-27T16:05:00Z)");
  const phone = normalizePhone(values.telefono ?? OFFICIAL_PHONE);
  const name = values.nombre ?? "WhatsApp Diluvium";

  const [existing] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.provider, "zernio"), eq(channels.providerAccountId, accountId)))
    .limit(1);
  if (existing) {
    console.log(
      `La cuenta ya tiene canal ${existing.id} ("${existing.displayName}", ${existing.phoneE164 ?? "sin teléfono"}, ` +
        `prueba ${existing.isTest}, activo ${existing.isActive}, archivado ${existing.archivedAt ? "sí" : "no"}, agente ${existing.aiAgentMode}). No se cambia nada.`,
    );
    return existing.isTest || !existing.isActive || existing.archivedAt ? 1 : 0;
  }

  let organizationId = values.org;
  if (!organizationId) {
    // Una sola organización en producción: se toma la del owner si no se indica.
    const orgs = await db.selectDistinct({ id: member.organizationId }).from(member).where(eq(member.role, "owner"));
    if (orgs.length !== 1) throw new Error(`Hay ${orgs.length} organizaciones con owner: indica --org`);
    organizationId = orgs[0].id;
  }
  const [samePhone] = await db
    .select({ id: channels.id, isActive: channels.isActive })
    .from(channels)
    .where(and(eq(channels.organizationId, organizationId), eq(channels.phoneE164, phone)))
    .limit(1);
  if (samePhone?.isActive) throw new Error(`Ya hay un canal activo con ${phone} (${samePhone.id}): revisar antes de crear otro`);

  const id = `ch_zernio_${accountId}`;
  console.log(
    `Canal NUEVO ${id} para la cuenta ${accountId} en la organización ${organizationId}: "${name}", ${phone}, ` +
      `conectado ${connectedAt.toISOString()}, REAL (sin marca Prueba), activo, agente APAGADO`,
  );
  if (!values.confirmar) {
    console.log("Simulación: no se cambió nada. Repite con --confirmar para aplicarlo.");
    return 0;
  }
  await db.insert(channels).values({
    id,
    organizationId,
    type: "whatsapp",
    provider: "zernio",
    providerAccountId: accountId,
    displayName: name,
    phoneE164: phone,
    isActive: true,
    isTest: false,
    connectedAt,
    aiAgentMode: "off",
  });
  console.log("Listo.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(safeErrorMessage(error));
    process.exit(1);
  });
