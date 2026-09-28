// Uso: npm run pruebas:limpiar -- --canal <id> [--canal <id> …] [--usuario <email>] [--confirmar]
// Bloque D (28-sep-2026): borra el HISTORIAL de los chats de canales de prueba ARCHIVADOS
// (celulares del negocio con los que se probó; docs/numero-prueba.md › Limpieza):
//   - borra sus conversaciones y lo que cuelga solo de ellas (mensajes, avisos y planes del
//     agente, corridas de workflow, programados, clics de anuncio) y el comprobante de pago
//     que haya salido de esos chats;
//   - CONSERVA los registros de Gasto de IA desligándolos del chat (conversation_id y
//     message_id en null): el Gasto de IA no cambia;
//   - quita la marca Prueba (contacts.es_prueba) a sus contactos. Los contactos NUNCA se
//     borran, ni sus chats con otros canales, ni sus marcas de workflows ya enviados;
//   - los canales se quedan archivados y ocultos; los archivos del bucket no se tocan;
//   - deja una fila en el Historial (Canales) con quién y cuántos.
// Guardas: solo canales archivados, inactivos y de prueba; se niega si hay trabajo en curso
// en esos chats o si algún chat a borrar es de otro canal. Todo en UNA transacción: si los
// chats, mensajes y contactos de los demás canales (el oficial) o el Gasto de IA no quedan
// iguales, se deshace. Sin --confirmar solo simula.
import { parseArgs } from "node:util";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { logChanges } from "@/lib/historial/log";

type Exec = Pick<typeof db, "execute">;

type Channel = {
  id: string;
  organization_id: string;
  display_name: string;
  is_active: boolean;
  is_test: boolean;
  archived_at: Date | null;
};

type Doomed = {
  conversaciones: number;
  mensajes: number;
  avisos: number;
  planes: number;
  corridas: number;
  programados: number;
  clics: number;
  comprobantes: number;
};

const DOOMED_LABELS: [keyof Doomed, string][] = [
  ["conversaciones", "conversaciones (chats)"],
  ["mensajes", "mensajes"],
  ["avisos", "avisos del agente"],
  ["planes", "planes del agente"],
  ["corridas", "corridas de workflow"],
  ["programados", "mensajes programados"],
  ["clics", "clics de anuncio"],
  ["comprobantes", "comprobantes de pago"],
];

type Kept = { channelId: string; nombre: string; conversaciones: number; mensajes: number; contactos: number };
type Totals = { contactos: number; usoIa: number; usoIaUsd: string; otros: Kept[] };

class Refusal extends Error {}
class VerificationFailed extends Error {}

const list = (ids: string[]): SQL => sql.join(
  ids.map((id) => sql`${id}`),
  sql`, `,
);

/** Chats a borrar: SOLO los de los canales indicados (ya verificados como archivados). */
const doomedConversations = (org: string, channelIds: string[]): SQL =>
  sql`select id from conversations where organization_id = ${org} and channel_id in (${list(channelIds)})`;

const doomedMessages = (org: string, channelIds: string[]): SQL =>
  sql`select id from messages where organization_id = ${org} and conversation_id in (${doomedConversations(org, channelIds)})`;

/** Comprobantes que salieron de esos chats (por su chat o por el mensaje con la imagen). */
const doomedReceipts = (org: string, channelIds: string[]): SQL => sql`
  organization_id = ${org} and (
    conversation_id in (${doomedConversations(org, channelIds)})
    or (conversation_id is null and message_id in (${doomedMessages(org, channelIds)})))`;

async function doomedCounts(exec: Exec, org: string, channelIds: string[]): Promise<Doomed> {
  const conv = doomedConversations(org, channelIds);
  const [row] = await exec.execute<Record<keyof Doomed, number>>(sql`
    select
      (select count(*)::int from conversations where id in (${conv})) as conversaciones,
      (select count(*)::int from messages where conversation_id in (${conv})) as mensajes,
      (select count(*)::int from ai_agent_notices where conversation_id in (${conv})) as avisos,
      (select count(*)::int from ai_agent_drafts where conversation_id in (${conv})) as planes,
      (select count(*)::int from workflow_runs where conversation_id in (${conv})) as corridas,
      (select count(*)::int from scheduled_messages where conversation_id in (${conv})) as programados,
      (select count(*)::int from ad_clicks where conversation_id in (${conv})) as clics,
      (select count(*)::int from comprobantes where ${doomedReceipts(org, channelIds)}) as comprobantes`);
  return Object.fromEntries(DOOMED_LABELS.map(([k]) => [k, Number(row[k])])) as Doomed;
}

async function usageOfDoomed(exec: Exec, org: string, channelIds: string[]) {
  const [row] = await exec.execute<{ n: number; usd: string | null }>(sql`
    select count(*)::int as n, coalesce(sum(cost_usd), 0)::numeric(12,4)::text as usd
    from ai_usage where organization_id = ${org} and conversation_id in (${doomedConversations(org, channelIds)})`);
  return { n: Number(row.n), usd: row.usd ?? "0" };
}

/** Lo que NO se debe mover: demás canales (el oficial), contactos y Gasto de IA de la organización. */
async function totals(exec: Exec, org: string, channelIds: string[]): Promise<Totals> {
  const otros = await exec.execute<{ id: string; nombre: string; conversaciones: number; mensajes: number; contactos: number }>(sql`
    select ch.id, ch.display_name as nombre,
      (select count(*)::int from conversations cv where cv.channel_id = ch.id) as conversaciones,
      (select count(*)::int from messages m join conversations cv on cv.id = m.conversation_id where cv.channel_id = ch.id) as mensajes,
      (select count(distinct cv.contact_id)::int from conversations cv where cv.channel_id = ch.id) as contactos
    from channels ch
    where ch.organization_id = ${org} and ch.id not in (${list(channelIds)})
    order by ch.created_at, ch.id`);
  const [row] = await exec.execute<{ contactos: number; uso: number; usd: string }>(sql`
    select
      (select count(*)::int from contacts where organization_id = ${org}) as contactos,
      (select count(*)::int from ai_usage where organization_id = ${org}) as uso,
      (select coalesce(sum(cost_usd), 0)::numeric(12,4)::text from ai_usage where organization_id = ${org}) as usd`);
  return {
    contactos: Number(row.contactos),
    usoIa: Number(row.uso),
    usoIaUsd: row.usd,
    otros: otros.map((o) => ({
      channelId: o.id,
      nombre: o.nombre,
      conversaciones: Number(o.conversaciones),
      mensajes: Number(o.mensajes),
      contactos: Number(o.contactos),
    })),
  };
}

async function pendingWork(exec: Exec, org: string, channelIds: string[]) {
  const conv = doomedConversations(org, channelIds);
  const [row] = await exec.execute<{ programados: number; corridas: number; planes: number }>(sql`
    select
      (select count(*)::int from scheduled_messages where conversation_id in (${conv}) and status in ('scheduled', 'sending')) as programados,
      (select count(*)::int from workflow_runs where conversation_id in (${conv}) and status in ('queued', 'running')) as corridas,
      (select count(*)::int from ai_agent_drafts where conversation_id in (${conv}) and status in ('pendiente', 'enviando')) as planes`);
  return { programados: Number(row.programados), corridas: Number(row.corridas), planes: Number(row.planes) };
}

type ContactLine = { ult4: string; ghl: boolean; esPrueba: boolean; borra: string; seQueda: number };

async function contactLines(exec: Exec, org: string, channelIds: string[]): Promise<ContactLine[]> {
  const rows = await exec.execute<{ ult4: string; ghl: boolean; es_prueba: boolean; borra: string; se_queda: number }>(sql`
    select right(c.phone_e164, 4) as ult4,
      (c.ghl_contact_id is not null or c.source = 'ghl_import') as ghl,
      c.es_prueba,
      (select string_agg(ch.display_name || ' (' ||
          (select count(*) from messages m where m.conversation_id = cv.id) || ')', ', ' order by ch.display_name)
        from conversations cv join channels ch on ch.id = cv.channel_id
        where cv.contact_id = c.id and cv.channel_id in (${list(channelIds)})) as borra,
      (select count(*)::int from conversations cv
        where cv.contact_id = c.id and cv.channel_id not in (${list(channelIds)})) as se_queda
    from contacts c
    where c.organization_id = ${org}
      and c.id in (select contact_id from conversations where id in (${doomedConversations(org, channelIds)}))
    order by c.created_at, c.phone_e164`);
  return rows.map((r) => ({ ult4: r.ult4, ghl: r.ghl, esPrueba: r.es_prueba, borra: r.borra, seQueda: Number(r.se_queda) }));
}

async function bucketFiles(exec: Exec, org: string, channelIds: string[]) {
  // Propios = guardados bajo org/<org>/messages/<id del mensaje>/; los demás son de la
  // Biblioteca (media_assets) y los usan otros chats. Ninguno se borra aquí.
  const [row] = await exec.execute<{ propios: number; biblioteca: number }>(sql`
    select
      count(*) filter (where x->>'storageKey' like 'org/%/messages/' || m.id || '/%')::int as propios,
      count(distinct x->>'storageKey') filter (
        where x->>'storageKey' is not null and x->>'storageKey' not like 'org/%/messages/' || m.id || '/%')::int as biblioteca
    from messages m
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(m.attachments) = 'array' then m.attachments else '[]'::jsonb end) x
    where m.conversation_id in (${doomedConversations(org, channelIds)})`);
  return { propios: Number(row.propios), biblioteca: Number(row.biblioteca) };
}

async function resolveUser(org: string, email: string | undefined) {
  const rows = await db.execute<{ id: string; name: string; email: string; role: string }>(sql`
    select u.id, u.name, u.email, m.role from member m join "user" u on u.id = m.user_id
    where m.organization_id = ${org} and m.role in ('owner', 'admin') and coalesce(u.banned, false) = false
      ${email ? sql`and lower(u.email) = lower(${email})` : sql`and m.role = 'owner'`}`);
  if (rows.length === 1) return rows[0];
  if (email) throw new Refusal(`Se niega: ${email} no es owner/admin activo de la organización.`);
  throw new Refusal(`Se niega: la organización tiene ${rows.length} owner(s) activos; indica quién con --usuario <email>.`);
}

function printTotals(label: string, t: Totals) {
  console.log(`${label}:`);
  for (const o of t.otros) {
    console.log(`  ${o.nombre}: ${o.conversaciones} chats · ${o.mensajes} mensajes · ${o.contactos} contactos`);
  }
  console.log(`  Contactos de la organización: ${t.contactos} · Gasto de IA: ${t.usoIa} registros (US$${t.usoIaUsd})`);
}

const sameTotals = (a: Totals, b: Totals) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const { values } = parseArgs({
    options: {
      canal: { type: "string", multiple: true },
      usuario: { type: "string" },
      confirmar: { type: "boolean", default: false },
    },
  });
  const channelIds = [...new Set((values.canal ?? []).map((c) => c.trim()).filter(Boolean))];

  if (channelIds.length === 0) {
    const archived = await db.execute<{ id: string; display_name: string }>(sql`
      select id, display_name from channels where archived_at is not null and is_test order by archived_at`);
    console.log("Indica los canales con --canal <id> (uno por canal). Canales de prueba archivados:");
    for (const ch of archived) console.log(`  --canal ${ch.id}   (${ch.display_name})`);
    throw new Refusal("Se niega: falta --canal.");
  }

  const found = await db.execute<Channel>(sql`
    select id, organization_id, display_name, is_active, is_test, archived_at
    from channels where id in (${list(channelIds)})`);
  for (const id of channelIds) {
    const ch = found.find((c) => c.id === id);
    if (!ch) throw new Refusal(`Se niega: no existe el canal ${id}.`);
    if (!ch.archived_at || ch.is_active) {
      throw new Refusal(`Se niega: el canal «${ch.display_name}» (${id}) no está archivado. Solo se limpian canales archivados.`);
    }
    if (!ch.is_test) {
      throw new Refusal(`Se niega: el canal «${ch.display_name}» (${id}) está archivado pero no es de prueba; su historial es real.`);
    }
  }
  const orgs = [...new Set(found.map((c) => c.organization_id))];
  if (orgs.length !== 1) throw new Refusal("Se niega: los canales son de organizaciones distintas; límpialos por separado.");
  const org = orgs[0];
  const user = await resolveUser(org, values.usuario?.trim());

  const doomed = await doomedCounts(db, org, channelIds);
  const usage = await usageOfDoomed(db, org, channelIds);
  const contacts = await contactLines(db, org, channelIds);
  const files = await bucketFiles(db, org, channelIds);
  const pending = await pendingWork(db, org, channelIds);
  const before = await totals(db, org, channelIds);
  const toUnmark = contacts.filter((c) => c.esPrueba).length;

  console.log(`Limpieza de chats de prueba — ${values.confirmar ? "CONFIRMADA" : "SIMULACIÓN (no se escribe nada)"}`);
  console.log(`Quién: ${user.name} (${user.role})`);
  console.log("Canales (archivados y de prueba; se quedan archivados y ocultos):");
  for (const ch of found) {
    const perChannel = await doomedCounts(db, org, [ch.id]);
    console.log(`  ${ch.display_name} (${ch.id}): ${perChannel.conversaciones} chats · ${perChannel.mensajes} mensajes`);
  }
  console.log("Se BORRA:");
  for (const [k, label] of DOOMED_LABELS) console.log(`  ${label.padEnd(24, ".")} ${doomed[k]}`);
  console.log(`Se CONSERVA desligado del chat: ${usage.n} registros de Gasto de IA (US$${usage.usd})`);
  console.log(`Se QUITA la marca Prueba a ${toUnmark} contacto(s). Contactos (nunca se borran):`);
  for (const c of contacts) {
    console.log(
      `  …${c.ult4}  ${c.ghl ? "GHL" : "   "}  Prueba: ${c.esPrueba ? "sí → no" : "no"}  ·  se borra: ${c.borra}  ·  ` +
        `chats que se quedan: ${c.seQueda}`,
    );
  }
  console.log(`Archivos del bucket: NO se tocan (${files.propios} propios de estos mensajes · ${files.biblioteca} de la Biblioteca).`);
  printTotals("NO se tocan — ANTES", before);

  if (pending.programados + pending.corridas + pending.planes > 0) {
    throw new Refusal(
      `Se niega: hay trabajo en curso en esos chats (${pending.programados} programado(s) por enviar, ` +
        `${pending.corridas} corrida(s) en cola o en ejecución, ${pending.planes} plan(es) pendiente(s)). Espera o cancélalo antes.`,
    );
  }
  if (doomed.conversaciones === 0) {
    console.log("No hay chats que borrar en esos canales: no se cambió nada.");
    return;
  }
  if (!values.confirmar) {
    console.log("Simulación: no se cambió nada. Repite con --confirmar para borrar.");
    return;
  }

  const subject = found.map((c) => c.display_name).join(", ");
  await db.transaction(async (tx) => {
    // Canales bloqueados: nadie los reactiva a media limpieza. Se revisan de nuevo.
    const locked = await tx.execute<Channel>(sql`
      select id, organization_id, display_name, is_active, is_test, archived_at
      from channels where organization_id = ${org} and id in (${list(channelIds)}) for update`);
    if (locked.length !== channelIds.length || locked.some((c) => !c.archived_at || c.is_active || !c.is_test)) {
      throw new Refusal("Se niega: un canal cambió (ya no está archivado o no es de prueba) mientras corría.");
    }
    const [foreign] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from conversations cv join channels ch on ch.id = cv.channel_id
      where cv.id in (${doomedConversations(org, channelIds)})
        and (ch.archived_at is null or ch.is_active or not ch.is_test or ch.organization_id <> ${org})`);
    if (Number(foreign.n) > 0) throw new Refusal("Se niega: algún chat a borrar es de un canal que no está archivado (el oficial).");
    const pendingNow = await pendingWork(tx, org, channelIds);
    if (pendingNow.programados + pendingNow.corridas + pendingNow.planes > 0) {
      throw new Refusal("Se niega: apareció trabajo en curso en esos chats mientras corría.");
    }

    const txBefore = await totals(tx, org, channelIds);
    const txDoomed = await doomedCounts(tx, org, channelIds);

    // 1) Gasto de IA: se conserva, sin chat ni mensaje.
    await tx.execute(sql`
      update ai_usage set conversation_id = null, message_id = null
      where organization_id = ${org} and conversation_id in (${doomedConversations(org, channelIds)})`);
    // 2) Comprobante(s) que salieron de esos chats.
    await tx.execute(sql`delete from comprobantes where ${doomedReceipts(org, channelIds)}`);
    // 3) Marca Prueba fuera (solo a los contactos de esos chats).
    const unmarked = await tx.execute<{ id: string }>(sql`
      update contacts set es_prueba = false
      where organization_id = ${org} and es_prueba
        and id in (select contact_id from conversations where id in (${doomedConversations(org, channelIds)}))
      returning id`);
    // 4) Los chats: la llave foránea borra en cascada mensajes, avisos, planes, corridas,
    //    programados y clics (el Gasto de IA ya quedó desligado).
    await tx.execute(sql`delete from conversations where organization_id = ${org} and channel_id in (${list(channelIds)})`);

    const left = await doomedCounts(tx, org, channelIds);
    const txAfter = await totals(tx, org, channelIds);
    const leftover = DOOMED_LABELS.filter(([k]) => left[k] !== 0).map(([, l]) => l);
    if (leftover.length > 0) throw new VerificationFailed(`quedó algo sin borrar: ${leftover.join(", ")}`);
    if (!sameTotals(txBefore, txAfter)) {
      printTotals("DESPUÉS (dentro de la transacción)", txAfter);
      throw new VerificationFailed("los demás canales, los contactos o el Gasto de IA no quedaron iguales");
    }

    await logChanges(tx, {
      organizationId: org,
      userId: user.id,
      kind: "canales",
      action: "limpiar_pruebas",
      subject,
      oldValue: `${txDoomed.conversaciones} chats · ${txDoomed.mensajes} mensajes · ${unmarked.length} contacto(s) con marca Prueba`,
      newValue:
        `0 chats (borrados) · marca Prueba quitada a ${unmarked.length} contacto(s) · ` +
        `${usage.n} registros de Gasto de IA conservados · ${txDoomed.comprobantes} comprobante(s) de prueba borrado(s)`,
    });
    // Repeatable read: el antes y el después de los demás canales salen de la MISMA foto, así
    // un mensaje en vivo del oficial durante la limpieza no parece una diferencia.
  }, { isolationLevel: "repeatable read" });

  const after = await totals(db, org, channelIds);
  const afterDoomed = await doomedCounts(db, org, channelIds);
  const [badge] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from conversations cv join channels ch on ch.id = cv.channel_id
    where cv.organization_id = ${org} and ch.is_test`);
  console.log(`HECHO. Quedan en esos canales: ${afterDoomed.conversaciones} chats, ${afterDoomed.mensajes} mensajes.`);
  printTotals("NO se tocan — DESPUÉS", after);
  console.log("Verificación dentro de la transacción: los demás canales, los contactos y el Gasto de IA quedaron IGUALES.");
  console.log(
    sameTotals(before, after)
      ? "→ Recontado después: IGUAL que antes."
      : "→ Recontado después: distinto del ANTES por tráfico en vivo del oficial mientras corría (no por la limpieza).",
  );
  console.log(`Chats con etiqueta PRUEBA en la Bandeja: ${Number(badge.n)}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error instanceof Refusal) console.error(error.message);
    else if (error instanceof VerificationFailed) console.error(`Se deshizo todo (nada se borró): ${error.message}.`);
    else console.error(error instanceof Error ? error.message : error);
    process.exit(error instanceof VerificationFailed ? 2 : 1);
  });
