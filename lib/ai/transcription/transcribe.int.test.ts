// Transcripción de notas de voz (parte 1, 26-sep-2026) contra Postgres REAL, con el
// bucket y OpenAI de mentira: texto y estado en el mensaje, costo por minuto en
// ai_usage, tope de 10 minutos, fallas sin trabarse y un solo cobro por audio.
// Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

// OGG/Opus mínimo: página con OpusHead y una página final con la posición (48 kHz).
function oggOpus(seconds: number): Uint8Array {
  const page = (granule: bigint, body: Uint8Array) => {
    const out = new Uint8Array(28 + body.length);
    out.set([0x4f, 0x67, 0x67, 0x53]);
    const v = new DataView(out.buffer);
    v.setBigUint64(6, granule, true);
    v.setUint32(14, 7, true);
    out[26] = 1;
    out[27] = body.length;
    out.set(body, 28);
    return out;
  };
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"));
  head[8] = 1;
  head[9] = 1;
  new DataView(head.buffer).setUint16(10, 312, true);
  const a = page(BigInt(0), head);
  const b = page(BigInt(Math.round(seconds * 48_000) + 312), new Uint8Array([0]));
  const all = new Uint8Array(a.length + b.length);
  all.set(a);
  all.set(b, a.length);
  return all;
}

describe.skipIf(!TEST_DATABASE_URL)("transcripción de notas de voz (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let t: typeof import("./transcribe");
  let d: typeof import("drizzle-orm");
  const ORG = "org_transcripcion";
  const CONV = "conv_transcripcion";
  const prevKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    t = await import("./transcribe");
    d = await import("drizzle-orm");
  });
  afterAll(async () => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = "sk-prueba";
    await db.delete(s.organization).where(d.eq(s.organization.id, ORG));
    await db.insert(s.organization).values({ id: ORG, name: "T", slug: "transcripcion", createdAt: new Date() });
    await db.insert(s.channels).values({ id: "ch_tr", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_tr", displayName: "D", aiAgentMode: "auto" });
    await db.insert(s.contacts).values({ id: "ct_tr", organizationId: ORG, firstName: "C" });
    await db.insert(s.conversations).values({ id: CONV, organizationId: ORG, contactId: "ct_tr", channelId: "ch_tr", providerConversationId: "zc_tr" });
  });

  let seq = 0;
  async function audioMsg(opts: { direction?: "in" | "out"; importedAt?: Date; createdAt?: Date } = {}) {
    const id = `m_tr_${++seq}`;
    await db.insert(s.messages).values({
      id,
      organizationId: ORG,
      conversationId: CONV,
      direction: opts.direction ?? "in",
      source: opts.direction === "out" ? "business_app" : "contact",
      type: "audio",
      attachments: [{ type: "audio", url: "/api/media/x", mimeType: "audio/ogg; codecs=opus", storageKey: `org/${id}.ogg` }],
      status: opts.direction === "out" ? "sent" : "received",
      importedAt: opts.importedAt ?? null,
      createdAt: opts.createdAt ?? new Date(),
    });
    return id;
  }
  const storageWith = (bytes: Uint8Array) => ({ getBytes: vi.fn(async () => bytes) }) as unknown as import("@/lib/storage/s3").ObjectStorage;
  const row = async (id: string) => (await db.select().from(s.messages).where(d.eq(s.messages.id, id)))[0];
  const usage = (id: string) => db.select().from(s.aiUsage).where(d.eq(s.aiUsage.messageId, id));

  it("lista: el texto va al mensaje, el estado a metadata y el costo por minuto a ai_usage; no se cobra dos veces", async () => {
    const id = await audioMsg();
    const transcriber = vi.fn(async () => ({ text: "  Son dos puertas de 95 y   105 centímetros " }));
    const r = await t.transcribeMessageAudio(storageWith(oggOpus(20)), id, { transcriber });
    expect(r).toEqual({ kind: "terminada", organizationId: ORG, conversationId: CONV, estado: "lista" });
    const m = await row(id);
    expect(m.transcripcion).toBe("Son dos puertas de 95 y 105 centímetros");
    expect(m.metadata).toMatchObject({ transcripcion: { estado: "lista", segundos: 20, modelo: "gpt-4o-mini-transcribe" } });
    const [u] = await usage(id);
    expect(u).toMatchObject({ stage: "transcripcion", provider: "openai", modelId: "gpt-4o-mini-transcribe", outcome: "transcrita", conversationId: CONV });
    expect(u.costUsd).toBeCloseTo(0.001, 8);
    expect(await t.transcribeMessageAudio(storageWith(oggOpus(20)), id, { transcriber })).toEqual({ kind: "no_aplica" });
    expect(transcriber).toHaveBeenCalledTimes(1);
  });

  it("más de 10 minutos: no se transcribe ni se cobra", async () => {
    const id = await audioMsg();
    const transcriber = vi.fn(async () => ({ text: "x" }));
    expect(await t.transcribeMessageAudio(storageWith(oggOpus(601)), id, { transcriber })).toMatchObject({ estado: "omitida", motivo: "dura más de 10 minutos" });
    expect(transcriber).not.toHaveBeenCalled();
    expect(await usage(id)).toEqual([]);
    expect((await row(id)).transcripcion).toBeNull();
  });

  it("si OpenAI falla: 'fallida' (el agente sigue sin texto), sin costo, y no se reintenta solo", async () => {
    const id = await audioMsg();
    const transcriber = vi.fn(async () => {
      throw new Error("429 rate limit");
    });
    expect(await t.transcribeMessageAudio(storageWith(oggOpus(15)), id, { transcriber })).toMatchObject({ estado: "fallida" });
    const [u] = await usage(id);
    expect(u).toMatchObject({ outcome: "transcripcion_fallida", costUsd: null });
    expect(await t.transcribeMessageAudio(storageWith(oggOpus(15)), id, { transcriber })).toEqual({ kind: "no_aplica" });
  });

  it("nunca: historial importado del celular, audios del vendedor, audios viejos, ni sin la llave de OpenAI", async () => {
    const transcriber = vi.fn(async () => ({ text: "x" }));
    const storage = storageWith(oggOpus(10));
    expect(await t.transcribeMessageAudio(storage, await audioMsg({ importedAt: new Date() }), { transcriber })).toEqual({ kind: "no_aplica" });
    expect(await t.transcribeMessageAudio(storage, await audioMsg({ direction: "out" }), { transcriber })).toEqual({ kind: "no_aplica" });
    expect(await t.transcribeMessageAudio(storage, await audioMsg({ createdAt: new Date(Date.now() - 2 * 3_600_000) }), { transcriber })).toEqual({ kind: "no_aplica" });
    delete process.env.OPENAI_API_KEY;
    expect(await t.transcribeMessageAudio(storage, await audioMsg(), { transcriber })).toEqual({ kind: "no_aplica" });
    expect(transcriber).not.toHaveBeenCalled();
  });

  it("dos jobs del mismo audio a la vez (reintento + barrido): una sola llamada pagada", async () => {
    const id = await audioMsg();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const transcriber = vi.fn(async () => {
      await gate;
      return { text: "hola" };
    });
    const a = t.transcribeMessageAudio(storageWith(oggOpus(5)), id, { transcriber });
    await new Promise((r) => setTimeout(r, 50));
    // Ve el intento vigente ("no_aplica") o pierde el reclamo atómico ("en_curso"): nunca paga.
    const b = await t.transcribeMessageAudio(storageWith(oggOpus(5)), id, { transcriber });
    expect(["no_aplica", "en_curso"]).toContain(b.kind);
    expect((await row(id)).metadata).toMatchObject({ transcripcion: { estado: "pendiente" } });
    release();
    expect(await a).toMatchObject({ estado: "lista" });
    expect(transcriber).toHaveBeenCalledTimes(1);
  });

  it("barrido: solo retoma intentos 'pendiente' viejos (worker reiniciado), nunca audios que jamás se intentaron", async () => {
    const nuevo = await audioMsg();
    const colgado = await audioMsg();
    await db
      .update(s.messages)
      .set({ metadata: { transcripcion: { estado: "pendiente", at: new Date(Date.now() - 5 * 60_000).toISOString() } } })
      .where(d.eq(s.messages.id, colgado));
    const ids = await t.staleTranscriptionIds(new Date());
    expect(ids).toContain(colgado);
    expect(ids).not.toContain(nuevo);
  });
});
