// Uso: npm run media:verificar-tipo -- [--confirmar] [--lote 200]
// S2 (30-sep-2026, revisión de seguridad CN-005): los adjuntos guardados ANTES de
// que el worker revisara el tipo real no traen `verifiedMime`, y el CRM solo
// muestra lo verificado. Este script lee los primeros bytes de cada uno en el
// bucket y anota su tipo real (imagen, audio, video o PDF, o "solo descarga").
//   - Solo lee el bucket; en la base solo agrega `verifiedMime` al adjunto (con la
//     fila bloqueada y sin pisar lo que otro proceso ya anotó). No borra nada.
//   - Idempotente: lo ya revisado no se vuelve a tocar; se puede correr varias veces.
//   - Sin --confirmar solo simula y cuenta.
//   - Además revisa (solo lectura) que los archivos de la Biblioteca coincidan con su tipo.
// Nunca imprime nombres de archivo ni textos: solo ids, tipos y conteos.
import { parseArgs } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, type MessageAttachment } from "@/lib/db/schema";
import { SNIFF_BYTES } from "@/lib/chat-attachments/sniff";
import { bytesMatchMime } from "@/lib/media-library/rules";
import { MEDIA_SNIFF_BYTES, OCTET, verifiedMediaMime } from "@/lib/messaging/media-type";
import { objectStorage } from "@/lib/storage/s3";
import { safeErrorMessage } from "@/lib/log/safe-error";

const { values } = parseArgs({
  options: { confirmar: { type: "boolean", default: false }, lote: { type: "string", default: "200" } },
});
const confirm = values.confirmar ?? false;
const batch = Math.max(1, Math.min(1000, Number(values.lote) || 200));

const storage = objectStorage();
if (!storage.getHead) throw new Error("el almacenamiento no permite leer el principio de un objeto");
const getHead = storage.getHead.bind(storage);

type Row = { id: string; organization_id: string; attachments: MessageAttachment[] };

const needs = (a: MessageAttachment) => Boolean(a.storageKey) && !a.verifiedMime;

const results = new Map<string, number>();
const octets: string[] = [];
let revisados = 0;
let sinObjeto = 0;
let mensajes = 0;

async function verifyMessage(row: Row): Promise<void> {
  const found = new Map<number, { storageKey: string; verifiedMime: string }>();
  for (const [index, a] of row.attachments.entries()) {
    if (!needs(a)) continue;
    const head = await getHead(a.storageKey!, MEDIA_SNIFF_BYTES).catch(() => null);
    if (!head || head.length === 0) {
      sinObjeto++;
      continue;
    }
    const verifiedMime = verifiedMediaMime(head, a.type);
    revisados++;
    results.set(`${a.type} → ${verifiedMime}`, (results.get(`${a.type} → ${verifiedMime}`) ?? 0) + 1);
    if (verifiedMime === OCTET) octets.push(`${row.id}#${index} (${a.type}, declarado ${a.mimeType ?? "sin tipo"})`);
    found.set(index, { storageKey: a.storageKey!, verifiedMime });
  }
  if (!confirm || found.size === 0) return;
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ attachments: messages.attachments })
      .from(messages)
      .where(and(eq(messages.id, row.id), eq(messages.organizationId, row.organization_id)))
      .for("update");
    if (!current) return;
    let changed = false;
    const merged = current.attachments.map((a, index) => {
      const f = found.get(index);
      // Solo si sigue siendo el mismo archivo y nadie lo anotó entretanto.
      if (!f || a.storageKey !== f.storageKey || a.verifiedMime) return a;
      changed = true;
      return { ...a, verifiedMime: f.verifiedMime };
    });
    if (!changed) return;
    await tx
      .update(messages)
      .set({ attachments: merged })
      .where(and(eq(messages.id, row.id), eq(messages.organizationId, row.organization_id)));
    mensajes++;
  });
}

async function main(): Promise<void> {
  console.log(confirm ? "Modo REAL: se anota verifiedMime." : "SIMULACIÓN (sin --confirmar): no se escribe nada.");
  let after = "";
  for (;;) {
    const rows = await db.execute<Row>(sql`
      select id, organization_id, attachments from messages
      where id > ${after}
        and exists (
          select 1 from jsonb_array_elements(attachments) a
          where a ? 'storageKey' and not a ? 'verifiedMime'
        )
      order by id
      limit ${batch}
    `);
    if (rows.length === 0) break;
    for (const row of rows) await verifyMessage(row);
    after = rows[rows.length - 1].id;
    console.log(`… ${revisados} adjuntos revisados`);
  }

  console.log("\nAdjuntos de mensajes (tipo de mensaje → tipo real):");
  for (const [k, n] of [...results.entries()].sort()) console.log(`  ${k}: ${n}`);
  console.log(`  revisados: ${revisados} · sin objeto en el bucket: ${sinObjeto}${confirm ? ` · mensajes actualizados: ${mensajes}` : ""}`);
  if (octets.length) {
    console.log(`\nQuedan como "solo descarga" (${octets.length}):`);
    for (const o of octets.slice(0, 50)) console.log(`  ${o}`);
    if (octets.length > 50) console.log(`  … y ${octets.length - 50} más`);
  }

  // Biblioteca: solo lectura (lo nuevo ya se revisa al subir).
  const assets = await db.execute<{ id: string; mime_type: string; storage_key: string }>(sql`
    select id, mime_type, storage_key from media_assets where deleted_at is null order by created_at
  `);
  const mismatched: string[] = [];
  for (const a of assets) {
    const head = await getHead(a.storage_key, SNIFF_BYTES).catch(() => null);
    if (!head || !bytesMatchMime(head, a.mime_type)) mismatched.push(`${a.id} (${a.mime_type})`);
  }
  console.log(`\nBiblioteca: ${assets.length} archivos; no coinciden con su tipo: ${mismatched.length}`);
  for (const m of mismatched) console.log(`  ${m}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    process.exit(1);
  });
