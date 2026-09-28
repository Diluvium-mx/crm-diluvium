// Bloque D: npm run pruebas:limpiar, corriéndolo DE VERDAD con tsx contra la base local de
// pruebas (en UTC, como producción). Solo con TEST_DATABASE_URL.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSX = `${ROOT}node_modules/.bin/tsx`;

function run(args: string[]) {
  const res = spawnSync(TSX, ["scripts/limpiar-chats-prueba.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
}

const TEST_CHANNELS = ["--canal", "ch_n2", "--canal", "ch_sb"];

// Oficial (vivo), dos de prueba archivados (N2 y sandbox), uno real archivado y uno de
// prueba sin archivar. Contactos: A = GHL con chat de prueba y con el oficial; B = marca
// Prueba con chats en los dos de prueba; C = solo chat de prueba.
const FIXTURE = [
  `insert into organization (id, name, slug, created_at) values ('org_l', 'org_l', 'org_l', now())`,
  `insert into "user" (id, name, email, email_verified, created_at, updated_at) values
    ('u_owner', 'Dueño', 'dueno@example.test', true, now(), now()),
    ('u_admin', 'Daniel', 'daniel@example.test', true, now(), now()),
    ('u_agent', 'Vendedor', 'vende@example.test', true, now(), now())`,
  `insert into member (id, organization_id, user_id, role, created_at) values
    ('m1', 'org_l', 'u_owner', 'owner', now()), ('m2', 'org_l', 'u_admin', 'admin', now()), ('m3', 'org_l', 'u_agent', 'agent', now())`,
  `insert into channels (id, organization_id, type, provider, provider_account_id, display_name, is_active, is_test, archived_at) values
    ('ch_of', 'org_l', 'whatsapp', 'zernio', 'acc_of', 'WhatsApp Diluvium', true, false, null),
    ('ch_n2', 'org_l', 'whatsapp', 'zernio', 'acc_n2', 'Número de prueba', false, true, now()),
    ('ch_sb', 'org_l', 'whatsapp', 'zernio', 'acc_sb', 'Sandbox Zernio', false, true, now()),
    ('ch_real_arch', 'org_l', 'whatsapp', 'zernio', 'acc_ra', 'Real archivado', false, false, now()),
    ('ch_prueba_viva', 'org_l', 'whatsapp', 'zernio', 'acc_pv', 'Prueba sin archivar', true, true, null)`,
  `insert into contacts (id, organization_id, first_name, phone_e164, source, ghl_contact_id, es_prueba, keyword_workflows_sent) values
    ('ct_a', 'org_l', 'A', '+526681110001', 'ghl_import', 'ghl_a', false, '{wf_1}'),
    ('ct_b', 'org_l', 'B', '+526681110002', 'whatsapp', null, true, '{wf_1}'),
    ('ct_c', 'org_l', 'C', '+526681110003', 'ghl_import', 'ghl_c', false, '{}'),
    ('ct_d', 'org_l', 'D', '+526681110004', 'whatsapp', null, false, '{}')`,
  `insert into conversations (id, organization_id, contact_id, channel_id) values
    ('cv_a_n2', 'org_l', 'ct_a', 'ch_n2'), ('cv_a_of', 'org_l', 'ct_a', 'ch_of'),
    ('cv_b_n2', 'org_l', 'ct_b', 'ch_n2'), ('cv_b_sb', 'org_l', 'ct_b', 'ch_sb'),
    ('cv_c_n2', 'org_l', 'ct_c', 'ch_n2'), ('cv_d_of', 'org_l', 'ct_d', 'ch_of'),
    ('cv_d_ra', 'org_l', 'ct_d', 'ch_real_arch')`,
  `insert into messages (id, organization_id, conversation_id, direction, source, type, body, status, attachments) values
    ('m_a_n2', 'org_l', 'cv_a_n2', 'in', 'contact', 'text', 'hola', 'delivered', '[]'),
    ('m_a_of', 'org_l', 'cv_a_of', 'in', 'contact', 'text', 'hola', 'delivered', '[]'),
    ('m_b_n2', 'org_l', 'cv_b_n2', 'in', 'contact', 'image', null, 'delivered',
      '[{"type":"image","storageKey":"org/org_l/messages/m_b_n2/0-foto.jpg","sizeBytes":10}]'),
    ('m_b_n2_out', 'org_l', 'cv_b_n2', 'out', 'ai_agent', 'video', null, 'read',
      '[{"type":"video","storageKey":"org/org_l/library/video.mp4","sizeBytes":99}]'),
    ('m_b_sb', 'org_l', 'cv_b_sb', 'in', 'contact', 'text', 'x', 'delivered', '[]'),
    ('m_c_n2', 'org_l', 'cv_c_n2', 'in', 'contact', 'text', 'x', 'delivered', '[]'),
    ('m_d_of', 'org_l', 'cv_d_of', 'out', 'crm', 'video', null, 'read',
      '[{"type":"video","storageKey":"org/org_l/library/video.mp4","sizeBytes":99}]'),
    ('m_d_ra', 'org_l', 'cv_d_ra', 'in', 'contact', 'text', 'real', 'delivered', '[]')`,
  `insert into ai_usage (id, organization_id, conversation_id, message_id, stage, provider, model_id, latency_ms, cost_usd) values
    ('u_prueba', 'org_l', 'cv_b_n2', 'm_b_n2', 'cerebro', 'anthropic', 'claude-sonnet-5', 10, 1.25),
    ('u_prueba2', 'org_l', 'cv_b_sb', null, 'cerebro', 'openai', 'gpt', 10, 0.5),
    ('u_oficial', 'org_l', 'cv_a_of', 'm_a_of', 'cerebro', 'anthropic', 'claude-sonnet-5', 10, 0.75)`,
  `insert into ai_agent_notices (id, organization_id, conversation_id, message_id, kind, body) values
    ('n_prueba', 'org_l', 'cv_b_n2', 'm_b_n2', 'otro', 'aviso'), ('n_oficial', 'org_l', 'cv_a_of', null, 'otro', 'aviso')`,
  `insert into ai_agent_drafts (id, organization_id, conversation_id, bubbles, status) values
    ('d_prueba', 'org_l', 'cv_c_n2', '[]', 'enviado'), ('d_oficial', 'org_l', 'cv_a_of', '[]', 'enviado')`,
  `insert into workflows (id, organization_id, slug, name) values ('wf_1', 'org_l', 'tabla', 'Tabla de tamaños')`,
  `insert into workflow_runs (id, organization_id, workflow_id, conversation_id, contact_id, trigger, status) values
    ('r_prueba', 'org_l', 'wf_1', 'cv_b_n2', 'ct_b', 'keyword', 'done'),
    ('r_oficial', 'org_l', 'wf_1', 'cv_a_of', 'ct_a', 'keyword', 'done')`,
  `insert into scheduled_messages (id, organization_id, conversation_id, created_by_user_id, kind, body, send_at, status) values
    ('s_prueba', 'org_l', 'cv_a_n2', 'u_agent', 'text', 'hola', now(), 'sent'),
    ('s_oficial', 'org_l', 'cv_a_of', 'u_agent', 'text', 'hola', now() + interval '1 day', 'scheduled')`,
  `insert into ad_clicks (id, organization_id, contact_id, conversation_id, message_id, origin, raw, clicked_at) values
    ('k_prueba', 'org_l', 'ct_c', 'cv_c_n2', 'm_c_n2', 'webhook', '{}', now()),
    ('k_oficial', 'org_l', 'ct_a', 'cv_a_of', 'm_a_of', 'webhook', '{}', now())`,
  `insert into comprobantes (id, organization_id, contact_id, conversation_id, message_id, monto, referencia_norm) values
    ('p_prueba', 'org_l', 'ct_b', 'cv_b_n2', 'm_b_n2', '39,500.00 MXN', 'REF1'),
    ('p_oficial', 'org_l', 'ct_a', 'cv_a_of', 'm_a_of', '1,000.00 MXN', 'REF2')`,
];

describe.skipIf(!TEST_DATABASE_URL)("pruebas:limpiar (tsx real)", () => {
  let db: typeof import("@/lib/db").db;
  let sql: typeof import("drizzle-orm").sql;

  const count = async (query: string) => Number((await db.execute<{ n: number }>(sql.raw(query)))[0].n);
  const ids = async (table: string) =>
    (await db.execute<{ id: string }>(sql.raw(`select id from ${table} order by id`))).map((r) => r.id);
  // Foto de TODO lo que la limpieza no debe mover (para "no escribió nada").
  const snapshot = async () => {
    const out: Record<string, string[]> = {};
    for (const t of ["conversations", "messages", "ai_agent_notices", "ai_agent_drafts", "workflow_runs", "scheduled_messages", "ad_clicks", "comprobantes", "contacts", "ai_usage", "change_history"]) {
      out[t] = await ids(t);
    }
    out.prueba = (await db.execute<{ id: string }>(sql.raw("select id from contacts where es_prueba order by id"))).map((r) => r.id);
    return out;
  };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    ({ sql } = await import("drizzle-orm"));
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate change_history, ai_usage, comprobantes, messages, conversations, channels, contacts, workflows, member, "user", organization cascade`);
    for (const statement of FIXTURE) await db.execute(sql.raw(statement));
  });

  it("sin --confirmar solo simula: muestra conteos y contactos por sus últimos 4 dígitos, y no escribe nada", async () => {
    const before = await snapshot();
    const r = run(TEST_CHANNELS);
    expect(r.code).toBe(0);
    expect(r.out).toContain("SIMULACIÓN");
    expect(r.out).toContain("Número de prueba (ch_n2): 3 chats · 4 mensajes");
    expect(r.out).toContain("Sandbox Zernio (ch_sb): 1 chats · 1 mensajes");
    expect(r.out).toMatch(/conversaciones \(chats\)\.+ 4/);
    expect(r.out).toMatch(/mensajes\.+ 5/);
    expect(r.out).toMatch(/comprobantes de pago\.+ 1/);
    expect(r.out).toContain("2 registros de Gasto de IA (US$1.7500)");
    expect(r.out).toContain("…0001  GHL  Prueba: no");
    expect(r.out).toContain("…0002       Prueba: sí → no");
    expect(r.out).toContain("1 propios de estos mensajes · 1 de la Biblioteca");
    expect(r.out).toContain("WhatsApp Diluvium: 2 chats · 2 mensajes · 2 contactos");
    expect(r.out).toContain("Quién: Dueño (owner)");
    expect(r.out).toContain("Simulación: no se cambió nada");
    expect(await snapshot()).toEqual(before);
  }, 60_000);

  it("--confirmar: borra solo los chats de prueba, conserva el Gasto de IA y los contactos, y deja fila en el Historial", async () => {
    const r = run([...TEST_CHANNELS, "--confirmar"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("HECHO. Quedan en esos canales: 0 chats, 0 mensajes.");
    expect(r.out).toContain("quedaron IGUALES");
    expect(r.out).toContain("Chats con etiqueta PRUEBA en la Bandeja: 0.");

    // Chats y lo que cuelga de ellos: solo quedan los del oficial y del real archivado.
    expect(await ids("conversations")).toEqual(["cv_a_of", "cv_d_of", "cv_d_ra"]);
    expect(await ids("messages")).toEqual(["m_a_of", "m_d_of", "m_d_ra"]);
    expect(await ids("ai_agent_notices")).toEqual(["n_oficial"]);
    expect(await ids("ai_agent_drafts")).toEqual(["d_oficial"]);
    expect(await ids("workflow_runs")).toEqual(["r_oficial"]);
    expect(await ids("scheduled_messages")).toEqual(["s_oficial"]);
    expect(await ids("ad_clicks")).toEqual(["k_oficial"]);
    expect(await ids("comprobantes")).toEqual(["p_oficial"]);

    // Gasto de IA: los 3 siguen; los de prueba sin chat ni mensaje; el oficial intacto.
    const usage = await db.execute<{ id: string; conversation_id: string | null; message_id: string | null; cost: string }>(
      sql`select id, conversation_id, message_id, cost_usd::text as cost from ai_usage order by id`,
    );
    expect(usage.map((u) => [u.id, u.conversation_id, u.message_id, Number(u.cost)])).toEqual([
      ["u_oficial", "cv_a_of", "m_a_of", 0.75],
      ["u_prueba", null, null, 1.25],
      ["u_prueba2", null, null, 0.5],
    ]);

    // Contactos: ninguno se borra; solo B pierde la marca; las marcas de workflows se quedan.
    expect(await ids("contacts")).toEqual(["ct_a", "ct_b", "ct_c", "ct_d"]);
    expect(await count("select count(*)::int as n from contacts where es_prueba")).toBe(0);
    expect(await count("select count(*)::int as n from contacts where keyword_workflows_sent = '{wf_1}'")).toBe(2);

    // Canales: siguen archivados, inactivos y de prueba.
    const chans = await db.execute<{ id: string; is_active: boolean; is_test: boolean; archived: boolean }>(
      sql`select id, is_active, is_test, archived_at is not null as archived from channels where id in ('ch_n2', 'ch_sb') order by id`,
    );
    expect(chans.map((c) => [c.id, c.is_active, c.is_test, c.archived])).toEqual([
      ["ch_n2", false, true, true],
      ["ch_sb", false, true, true],
    ]);

    // Historial: quién y cuántos.
    const hist = await db.execute<{ user_id: string; kind: string; action: string; subject: string; old_value: string; new_value: string }>(
      sql`select user_id, kind, action, subject, old_value, new_value from change_history`,
    );
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({
      user_id: "u_owner",
      kind: "canales",
      action: "limpiar_pruebas",
      subject: "Número de prueba, Sandbox Zernio",
      old_value: "4 chats · 5 mensajes · 1 contacto(s) con marca Prueba",
      new_value: "0 chats (borrados) · marca Prueba quitada a 1 contacto(s) · 2 registros de Gasto de IA conservados · 1 comprobante(s) de prueba borrado(s)",
    });

    // Una segunda corrida no encuentra nada ni deja otra fila.
    const again = run([...TEST_CHANNELS, "--confirmar"]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("No hay chats que borrar");
    expect(await count("select count(*)::int as n from change_history")).toBe(1);
  }, 60_000);

  it("--usuario: la fila del Historial lleva a quien se indique (owner/admin); un vendedor se rechaza", async () => {
    const agent = run([...TEST_CHANNELS, "--usuario", "vende@example.test", "--confirmar"]);
    expect(agent.code).toBe(1);
    expect(agent.out).toContain("no es owner/admin activo");
    expect(await count("select count(*)::int as n from conversations")).toBe(7);

    const admin = run([...TEST_CHANNELS, "--usuario", "Daniel@Example.test", "--confirmar"]);
    expect(admin.code).toBe(0);
    expect(await count("select count(*)::int as n from change_history where user_id = 'u_admin'")).toBe(1);
  }, 60_000);

  it.each([
    ["ch_of", "no está archivado"],
    ["ch_prueba_viva", "no está archivado"],
    ["ch_real_arch", "no es de prueba"],
    ["ch_no_existe", "no existe el canal"],
  ])("se niega con --canal %s (%s) y no escribe nada", async (canal, motivo) => {
    const before = await snapshot();
    const r = run(["--canal", "ch_n2", "--canal", canal, "--confirmar"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(motivo);
    expect(await snapshot()).toEqual(before);
  }, 60_000);

  it("si el oficial no queda igual dentro de la transacción, se deshace TODO (sale con 2)", async () => {
    // Trigger de prueba: al borrar un chat, aparece un mensaje en el chat oficial de D.
    await db.execute(sql.raw(`create or replace function t_limpieza_toca_oficial() returns trigger language plpgsql as $$
      begin
        insert into messages (id, organization_id, conversation_id, direction, source, type, status, attachments)
          values ('m_intruso_' || old.id, 'org_l', 'cv_d_of', 'in', 'contact', 'text', 'delivered', '[]');
        return old;
      end $$`));
    await db.execute(sql.raw("create trigger t_limpieza_toca_oficial after delete on conversations for each row execute function t_limpieza_toca_oficial()"));
    try {
      const before = await snapshot();
      const r = run([...TEST_CHANNELS, "--confirmar"]);
      expect(r.code).toBe(2);
      expect(r.out).toContain("Se deshizo todo (nada se borró): los demás canales, los contactos o el Gasto de IA no quedaron iguales");
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.execute(sql.raw("drop trigger if exists t_limpieza_toca_oficial on conversations"));
      await db.execute(sql.raw("drop function if exists t_limpieza_toca_oficial()"));
    }
  }, 60_000);

  it("se niega si hay trabajo en curso en esos chats (programado por enviar)", async () => {
    await db.execute(sql`update scheduled_messages set status = 'scheduled' where id = 's_prueba'`);
    const before = await snapshot();
    const r = run([...TEST_CHANNELS, "--confirmar"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("hay trabajo en curso");
    expect(await snapshot()).toEqual(before);
  }, 60_000);

  it("sin --canal lista los canales de prueba archivados y se niega", async () => {
    const r = run(["--confirmar"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("--canal ch_n2");
    expect(r.out).toContain("--canal ch_sb");
    expect(r.out).not.toContain("--canal ch_real_arch");
    expect(r.out).toContain("falta --canal");
  }, 60_000);
});
