// Uso: npm run canal:instagram -- --cuenta <accountId> --usuario <@usuario> [--prueba] [--org <id>] [--confirmar]
// Alta del canal de INSTAGRAM (docs/instagram.md, paso «Conectar»):
// - el accountId lo da Zernio al conectar la cuenta (GET /v1/accounts, platform "instagram");
// - --usuario = el @ de la cuenta de Diluvium: el canal se llama "Instagram @usuario";
// - --prueba = cuenta de PRUEBA (staging, perfil "Diluvium Pruebas"): marca Prueba, no cuenta
//   en el Dashboard;
// - activo y con el Agente IA APAGADO: se enciende desde Agente IA › Canales (queda en el
//   Historial) en cuanto la conexión se probó (decisión del dueño, 2-oct-2026);
// - se corre ANTES de sumar la cuenta a ZERNIO_ALLOWED_ACCOUNT_IDS (así no hay hueco: lo que
//   llegue antes queda en cuarentena y se libera con scripts/replay-webhook-events.ts).
// Si la cuenta ya tiene canal, no cambia nada y lo muestra. Sin --confirmar solo muestra lo
// que haría. Nunca borra nada.
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, member } from "@/lib/db/schema";
import { safeErrorMessage } from "@/lib/log/safe-error";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      cuenta: { type: "string" },
      usuario: { type: "string" },
      prueba: { type: "boolean", default: false },
      org: { type: "string" },
      confirmar: { type: "boolean", default: false },
    },
  });
  const accountId = values.cuenta?.trim();
  if (!accountId || !/^[A-Za-z0-9_-]{6,64}$/.test(accountId)) throw new Error("--cuenta <accountId de Zernio> es obligatorio");
  const username = values.usuario?.trim().replace(/^@+/, "");
  if (!username || !/^[A-Za-z0-9._]{1,30}$/.test(username)) throw new Error("--usuario <@usuario de Instagram> es obligatorio");
  const name = `Instagram @${username}`;

  const [existing] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.provider, "zernio"), eq(channels.providerAccountId, accountId)))
    .limit(1);
  if (existing) {
    console.log(
      `La cuenta ya tiene canal ${existing.id} ("${existing.displayName}", ${existing.type}, prueba ${existing.isTest}, ` +
        `activo ${existing.isActive}, archivado ${existing.archivedAt ? "sí" : "no"}, agente ${existing.aiAgentMode}). No se cambia nada.`,
    );
    return existing.type !== "instagram" || !existing.isActive || existing.archivedAt ? 1 : 0;
  }

  let organizationId = values.org;
  if (!organizationId) {
    // Una sola organización por entorno: se toma la del owner si no se indica.
    const orgs = await db.selectDistinct({ id: member.organizationId }).from(member).where(eq(member.role, "owner"));
    if (orgs.length !== 1) throw new Error(`Hay ${orgs.length} organizaciones con owner: indica --org`);
    organizationId = orgs[0].id;
  }

  const id = `ch_zernio_${accountId}`;
  console.log(
    `Canal NUEVO ${id} para la cuenta ${accountId} en la organización ${organizationId}: "${name}", Instagram, ` +
      `${values.prueba ? "de PRUEBA" : "REAL (sin marca Prueba)"}, activo, Agente IA APAGADO`,
  );
  if (!values.confirmar) {
    console.log("Simulación: no se cambió nada. Repite con --confirmar para aplicarlo.");
    return 0;
  }
  await db.insert(channels).values({
    id,
    organizationId,
    type: "instagram",
    provider: "zernio",
    providerAccountId: accountId,
    displayName: name,
    phoneE164: null,
    isActive: true,
    isTest: values.prueba,
    // Sin hora de conexión: en Instagram no hay historial del celular (coexistencia), así que
    // todo lo que llega por webhook es en vivo, también lo liberado de la cuarentena.
    connectedAt: null,
    aiAgentMode: "off",
  });
  console.log("Listo. Siguiente: sumar la cuenta a ZERNIO_ALLOWED_ACCOUNT_IDS y encender el Agente IA en Agente IA › Canales.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(safeErrorMessage(error));
    process.exit(1);
  });
