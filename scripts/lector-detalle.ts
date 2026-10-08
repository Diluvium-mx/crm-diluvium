// Pasada ÚNICA del lector en segundo plano (28-sep-2026, pedido del dueño): lee los chats
// con mensajes desde una fecha y deja al día su etapa y Detalle (lib/ai/runtime/lector.ts).
// Lo nuevo después lo hace solo el barrido del worker.
//
// Ensayo (no llama al modelo ni escribe; cuenta chats y estima tokens y costo con Luna):
//   npm run lector:detalle -- --desde 2026-09-27T07:00:00Z --ensayo
// Pasada real (escribe en la base; al final imprime chats, tokens y costo en USD):
//   npm run lector:detalle -- --desde 2026-09-27T07:00:00Z [--hasta <ISO>] [--limite N]
// Producción: con las variables del worker (llave de OpenAI y bucket) y la base por su
// proxy TCP (docs/numero-prueba.md). Hora de Mazatlán = UTC-7: 27-sep 00:00 = 07:00Z.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { callModel, getModel } from "@/lib/ai";
import { computeCostUsd } from "@/lib/ai/pricing";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { loadHistory, messageAt } from "@/lib/ai/runtime/context";
import { buildLectorMessages, buildLectorSystem, LECTOR_MODEL_ID, type LectorMessage } from "@/lib/ai/runtime/lector-core";
import { runLector, type LectorOutcome } from "@/lib/ai/runtime/lector";
import type { KvPort } from "@/lib/ai/runtime/queue";
import { fitHistory } from "@/lib/ai/runtime/transcript";
import { effectivePrice } from "@/lib/ai/runtime/usage";
import { objectStorage, StorageNotConfiguredError, type ObjectStorage } from "@/lib/storage/s3";
import { safeErrorMessage } from "@/lib/log/safe-error";

// Estimación del ensayo: ~3.5 caracteres por token en español; una imagen ~1,000 tokens;
// la respuesta (razonamiento + herramienta) ~400 tokens. La pasada real da los números exactos.
const CHARS_PER_TOKEN = 3.5;
const TOKENS_PER_MEDIA = 1_000;
const OUTPUT_TOKENS = 400;
const FICHA_CHARS = 600;
const CONCURRENCY = 3;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Candado en memoria: la escritura del Detalle ya se serializa por la fila del contacto.
function memoryKv(): KvPort {
  const m = new Map<string, string>();
  return {
    setNxPx: async (k, v) => (m.has(k) ? false : (m.set(k, v), true)),
    setEx: async (k, v) => void m.set(k, v),
    getDel: async (k) => {
      const v = m.get(k) ?? null;
      m.delete(k);
      return v;
    },
    delIfEquals: async (k, v) => void (m.get(k) === v && m.delete(k)),
  };
}

function storageOrNull(): ObjectStorage | null {
  try {
    return objectStorage();
  } catch (error) {
    if (!(error instanceof StorageNotConfiguredError)) throw error;
    console.warn("Sin bucket: el lector no verá imágenes ni PDF (solo texto).");
    return null;
  }
}

async function main(): Promise<void> {
  const desde = arg("desde");
  if (!desde || Number.isNaN(Date.parse(desde))) throw new Error("Falta --desde <ISO en UTC>, p. ej. 2026-09-27T07:00:00Z");
  const hasta = arg("hasta") ?? new Date().toISOString();
  const limite = Number(arg("limite") ?? 10_000);
  const ensayo = process.argv.includes("--ensayo");

  const rows = await db.execute<{ id: string; organization_id: string }>(sql`
    select c.id, c.organization_id
    from conversations c
    where exists (
      select 1 from messages m
      where m.organization_id = c.organization_id and m.conversation_id = c.id
        and m.created_at >= ${new Date(desde).toISOString()}::timestamp and m.created_at <= ${new Date(hasta).toISOString()}::timestamp
    )
    order by c.last_message_at asc
    limit ${limite}
  `);
  const chats = rows.map((r) => ({ conversationId: r.id, organizationId: r.organization_id }));
  console.log(`${chats.length} chat(s) con mensajes entre ${desde} y ${hasta} (${ensayo ? "ENSAYO: no se llama al modelo ni se escribe" : "pasada REAL"})`);
  if (chats.length === 0) return;

  const model = getModel(LECTOR_MODEL_ID);
  if (!model) throw new Error(`${LECTOR_MODEL_ID} no está en el catálogo`);
  const price = await effectivePrice(chats[0].organizationId, model.id, model.provider);

  if (ensayo) {
    let input = 0;
    let media = 0;
    let mensajes = 0;
    const stagesByOrg = new Map<string, Awaited<ReturnType<typeof listFunnelStages>>>();
    for (const c of chats) {
      if (!stagesByOrg.has(c.organizationId)) stagesByOrg.set(c.organizationId, await listFunnelStages(c.organizationId));
      const stages = stagesByOrg.get(c.organizationId)!;
      const history = fitHistory(await loadHistory(c.organizationId, c.conversationId));
      const lm: LectorMessage[] = history.map((m) => ({ ...m, at: messageAt(m) }));
      const { messages } = buildLectorMessages(lm, new Map(), { ficha: "x".repeat(FICHA_CHARS) });
      const content = messages[0].content;
      const chars = (typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "")).join("\n")).length;
      input += (buildLectorSystem(stages).length + chars) / CHARS_PER_TOKEN;
      media += Math.min(6, history.filter((m) => m.direction === "in" && m.attachments.some((a) => a.type === "image" || a.mimeType === "application/pdf")).length);
      mensajes += history.length;
    }
    input += media * TOKENS_PER_MEDIA;
    const output = chats.length * OUTPUT_TOKENS;
    const usd = computeCostUsd({ inputTokens: Math.round(input), outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 }, price);
    console.log(`mensajes leídos: ${mensajes} · imágenes/PDF del cliente: ${media}`);
    console.log(`tokens estimados: entrada ${Math.round(input).toLocaleString("es-MX")} · salida ${output.toLocaleString("es-MX")}`);
    console.log(`costo estimado con ${model.id} (sin caché, tope): US$${(usd ?? 0).toFixed(4)}`);
    return;
  }

  const storage = storageOrNull();
  const deps = {
    now: () => new Date(),
    callModel,
    resolveImage: async (key: string) => (storage ? storage.signedGetUrl(key, 15 * 60) : null),
    kv: memoryKv(),
  };
  const totals = { leidos: 0, conCambios: 0, errores: 0, input: 0, cacheRead: 0, output: 0, usd: 0 };
  for (let i = 0; i < chats.length; i += CONCURRENCY) {
    await Promise.all(
      chats.slice(i, i + CONCURRENCY).map(async (c) => {
        const o: LectorOutcome = await runLector(c.organizationId, c.conversationId, deps, { force: true }).catch((e: unknown) => ({
          kind: "error" as const,
          reason: safeErrorMessage(e),
          usage: null,
          costUsd: null,
        }));
        if (o.kind === "leido" || o.kind === "error") {
          totals.input += o.usage?.inputTokens ?? 0;
          totals.cacheRead += o.usage?.cacheReadTokens ?? 0;
          totals.output += o.usage?.outputTokens ?? 0;
          totals.usd += o.costUsd ?? 0;
        }
        if (o.kind === "leido") {
          totals.leidos++;
          if (o.cambios.length) totals.conCambios++;
          console.log(`${c.conversationId}: ${o.cambios.length ? o.cambios.join(", ") : "sin cambios"}${o.ignored.length ? ` · descartado: ${o.ignored.join("; ")}` : ""}`);
        } else if (o.kind === "error") {
          totals.errores++;
          console.log(`${c.conversationId}: ERROR ${o.reason}`);
        } else console.log(`${c.conversationId}: ${o.kind}`);
      }),
    );
  }
  console.log("── Resumen ──");
  console.log(`chats leídos: ${totals.leidos} de ${chats.length} (con cambios: ${totals.conCambios}; errores: ${totals.errores})`);
  console.log(`tokens: entrada ${totals.input.toLocaleString("es-MX")} (de caché ${totals.cacheRead.toLocaleString("es-MX")}) · salida ${totals.output.toLocaleString("es-MX")}`);
  console.log(`costo con ${model.id}: US$${totals.usd.toFixed(4)} (el mismo que queda en ai_usage, etapa "detalle")`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(safeErrorMessage(e));
    process.exit(1);
  });
