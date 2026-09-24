// Siembra idempotente del conocimiento de Angela (Fase B):
//   - Goal        -> ai_config.goal
//   - 47 FAQs     -> ai_knowledge (upsert por organization_id + ghl_id)
// El contenido NO se hardcodea: se lee de las fuentes versionadas
// docs/agente-ia/angela-goal.md y docs/agente-ia/angela-faqs.json. Re-ejecutable
// (upsert), no borra nada y preserva el toggle `enabled` que se haya puesto en el CRM.
// Desde el 24-sep-2026 la fuente de verdad es la pestaña "Agente IA": si el Goal o las
// FAQs ya se editaron ahí (hay versiones), el seed NO corre (pisaría lo editado sin
// dejar versión). Solo con SEED_FORCE=1 se regresa a las fuentes de docs/.
//
// Uso local (org única en la base):   npm run seed:ai-knowledge
// Org explícita:                      SEED_ORG_ID=<org> npm run seed:ai-knowledge
// Staging:  railway run -e staging    -s crm-diluvium npm run seed:ai-knowledge
// Prod:     railway run -e production -s crm-diluvium sh -c 'SEED_ORG_ID=<orgProd> npm run seed:ai-knowledge'
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema/auth";
import { aiConfig, aiKnowledge, aiKnowledgeVersions } from "@/lib/db/schema";
import { DEFAULT_BRAIN_MODEL, DEFAULT_FILTER_MODEL } from "@/lib/ai/catalog";

const goalUrl = new URL("../docs/agente-ia/angela-goal.md", import.meta.url);
const faqsUrl = new URL("../docs/agente-ia/angela-faqs.json", import.meta.url);

type FaqRow = { position: number; ghl_id: string; question: string; answer: string };

function loadFaqs(): FaqRow[] {
  const parsed = JSON.parse(readFileSync(faqsUrl, "utf8")) as unknown;
  const faqs = (parsed as { faqs?: unknown }).faqs ?? parsed;
  if (!Array.isArray(faqs)) throw new Error("angela-faqs.json: no encontré el arreglo `faqs`.");
  for (const f of faqs as FaqRow[]) {
    if (!f.ghl_id || !f.question || !f.answer || typeof f.position !== "number") {
      throw new Error(`FAQ inválida (falta ghl_id/question/answer/position): ${JSON.stringify(f).slice(0, 120)}`);
    }
  }
  return faqs as FaqRow[];
}

async function resolveOrgId(): Promise<string> {
  const wanted = process.env.SEED_ORG_ID ?? process.argv[2];
  if (wanted) {
    const [o] = await db.select({ id: organization.id }).from(organization).where(eq(organization.id, wanted));
    if (!o) throw new Error(`La organización ${wanted} no existe en esta base.`);
    return o.id;
  }
  const orgs = await db.select({ id: organization.id, name: organization.name }).from(organization);
  if (orgs.length !== 1) {
    const list = orgs.map((o) => `${o.id}:${o.name}`).join(" | ");
    throw new Error(`Hay ${orgs.length} organizaciones; especifica SEED_ORG_ID. (${list})`);
  }
  return orgs[0].id;
}

async function main(): Promise<void> {
  const goal = readFileSync(goalUrl, "utf8").trimEnd();
  const faqs = loadFaqs();
  const orgId = await resolveOrgId();
  const now = new Date();

  const [edited] = await db
    .select({ id: aiKnowledgeVersions.id })
    .from(aiKnowledgeVersions)
    .where(eq(aiKnowledgeVersions.organizationId, orgId))
    .limit(1);
  if (edited && process.env.SEED_FORCE !== "1") {
    throw new Error(
      "El Goal o las FAQs ya se editaron desde la pestaña Agente IA: el seed los pisaría sin dejar versión. " +
        "No se tocó nada. Edita desde la pestaña (o usa SEED_FORCE=1 solo si de verdad quieres volver a las fuentes de docs/).",
    );
  }

  // Goal -> ai_config.goal. Si la fila no existe, se crea con los modelos por
  // defecto del catálogo; si existe, solo se actualiza el goal (no se pisan los
  // modelos elegidos por el admin).
  await db
    .insert(aiConfig)
    .values({
      organizationId: orgId,
      modeloFiltro: DEFAULT_FILTER_MODEL,
      modeloCerebro: DEFAULT_BRAIN_MODEL,
      goal,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: aiConfig.organizationId, set: { goal, updatedAt: now } });

  // FAQs -> ai_knowledge. Upsert por (org, ghl_id): actualiza contenido/posición
  // pero NO toca `enabled` (respeta un apagado manual desde el CRM).
  for (const f of faqs) {
    await db
      .insert(aiKnowledge)
      .values({
        id: randomUUID(),
        organizationId: orgId,
        ghlId: f.ghl_id,
        question: f.question,
        answer: f.answer,
        position: f.position,
        enabled: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [aiKnowledge.organizationId, aiKnowledge.ghlId],
        targetWhere: isNotNull(aiKnowledge.ghlId),
        set: { question: f.question, answer: f.answer, position: f.position, updatedAt: now },
      });
  }

  const rows = await db
    .select({ id: aiKnowledge.id })
    .from(aiKnowledge)
    .where(eq(aiKnowledge.organizationId, orgId));
  const [cfg] = await db.select({ goal: aiConfig.goal }).from(aiConfig).where(eq(aiConfig.organizationId, orgId));

  console.log(`[seed-ai-knowledge] org=${orgId}`);
  console.log(`  FAQs en fuente: ${faqs.length} | FAQs en ai_knowledge (org): ${rows.length}`);
  console.log(`  ai_config.goal: ${cfg?.goal ? `${cfg.goal.length} chars` : "VACÍO"}`);
  if (rows.length < faqs.length) throw new Error("Conteo de FAQs en la base menor al de la fuente.");
  if (!cfg?.goal) throw new Error("ai_config.goal quedó vacío.");
  console.log("[seed-ai-knowledge] OK (idempotente).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
