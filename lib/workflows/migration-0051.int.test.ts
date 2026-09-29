// Migración 0051: la marca inicial de «El workflow es la respuesta» = los workflows que HOY terminan
// en pregunta. Se corre el UPDATE tal cual está en el archivo y se compara con endsWithQuestionStep
// (la regla que reemplaza), para que nada cambie para «Precio 2», «Información» y «Tenemos».
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepPayload } from "@/lib/db/schema/automation";
import { endsWithQuestionStep } from "./steps";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("migración 0051: marca inicial de «El workflow es la respuesta»", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let sql: typeof import("drizzle-orm").sql;
  const ORG = "org_m51";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ sql } = await import("drizzle-orm"));
  });
  beforeEach(async () => {
    await db.execute(sql`truncate workflow_runs, workflow_steps, workflows, organization cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const cases: Record<string, WorkflowStepPayload[]> = {
    precio_2: [
      { kind: "send_text", text: "Tenemos varios tamaños" },
      { kind: "send_media", assetId: "a", title: "Tabla", caption: "Estos son los tamaños que manejamos" },
      { kind: "send_text", text: "¿Usted tiene problemas de inundaciones?" },
    ],
    pie_con_emoji: [{ kind: "send_media", assetId: "a", title: "Video", caption: "¿Le interesa? 🙌 " }],
    pregunta_a_media_frase: [{ kind: "send_text", text: "¿Le interesa? Aquí está el video" }],
    tabla_sin_pregunta: [{ kind: "wait", seconds: 18 }, { kind: "send_media", assetId: "a", title: "Tabla", caption: "Aquí le comparto una foto de los tamaños" }],
    espera_al_final: [{ kind: "send_text", text: "¿Cuánto mide?" }, { kind: "wait", seconds: 5 }],
    sin_pasos: [],
  };

  it("marca exactamente los que terminan en pregunta (igual que endsWithQuestionStep) y no toca a los ya marcados", async () => {
    for (const [slug, steps] of Object.entries(cases)) {
      await db.insert(s.workflows).values({ id: slug, organizationId: ORG, slug, name: slug, isAnswer: false });
      if (steps.length) {
        await db.insert(s.workflowSteps).values(steps.map((payload, position) => ({ id: `${slug}_${position}`, organizationId: ORG, workflowId: slug, position, kind: payload.kind, payload })));
      }
    }
    const file = readFileSync(path.join(process.cwd(), "drizzle/0051_tabla_y_es_la_respuesta.sql"), "utf8");
    const update = file.split("--> statement-breakpoint").map((st) => st.trim()).find((st) => st.startsWith("UPDATE"));
    expect(update).toBeTruthy();
    await db.execute(sql.raw(update!));
    const rows = await db.select({ slug: s.workflows.slug, isAnswer: s.workflows.isAnswer }).from(s.workflows);
    const marked = Object.fromEntries(rows.map((r) => [r.slug, r.isAnswer]));
    expect(marked).toEqual(Object.fromEntries(Object.entries(cases).map(([slug, steps]) => [slug, endsWithQuestionStep(steps)])));
    expect(marked).toMatchObject({ precio_2: true, pie_con_emoji: true, pregunta_a_media_frase: false, tabla_sin_pregunta: false, espera_al_final: false, sin_pasos: false });
  });
});
