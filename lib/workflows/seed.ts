// Siembra los workflows predeterminados de una organización. Idempotente por
// (org, slug): un predeterminado que ya existe NO se toca (el admin pudo
// haberlo editado); solo se crean los que faltan. La usa el hook de creación
// de organizaciones (lib/auth/index.ts) y el botón "Restaurar predeterminados"
// de la pestaña Automatización (para la organización que ya existía antes de
// la migración 0025).
import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { workflowSteps, workflows } from "@/lib/db/schema/automation";
import { DEFAULT_WORKFLOWS } from "./defaults";

type Db = Pick<typeof appDb, "select" | "insert" | "transaction">;

export async function seedDefaultWorkflows(database: Db, organizationId: string): Promise<{ created: string[] }> {
  const existing = await database
    .select({ slug: workflows.slug })
    .from(workflows)
    .where(eq(workflows.organizationId, organizationId));
  const have = new Set(existing.map((r) => r.slug));
  const created: string[] = [];
  for (const [i, def] of DEFAULT_WORKFLOWS.entries()) {
    if (have.has(def.slug)) continue;
    const id = crypto.randomUUID();
    await database.transaction(async (tx) => {
      // Un comando ya usado por otro workflow de la org no se pisa: el
      // predeterminado nace sin comando y el admin lo asigna.
      const commandTaken = def.triggerCommand
        ? (
            await tx
              .select({ id: workflows.id })
              .from(workflows)
              .where(and(eq(workflows.organizationId, organizationId), eq(workflows.triggerCommand, def.triggerCommand)))
              .limit(1)
          ).length > 0
        : false;
      await tx.insert(workflows).values({
        id,
        organizationId,
        slug: def.slug,
        name: def.name,
        agentDescription: def.agentDescription,
        // Nace apagado: el admin revisa textos, sube los archivos y lo enciende.
        enabled: false,
        isSystem: true,
        triggerAgent: def.triggerAgent,
        triggerKeywords: def.triggerKeywords,
        triggerCommand: commandTaken ? null : def.triggerCommand,
        triggerStage: null,
        oncePerConversation: def.oncePerConversation,
        position: i,
      });
      if (def.steps.length > 0) {
        await tx.insert(workflowSteps).values(
          def.steps.map((payload, position) => ({
            id: crypto.randomUUID(),
            organizationId,
            workflowId: id,
            position,
            kind: payload.kind,
            payload,
          })),
        );
      }
    });
    created.push(def.slug);
  }
  return { created };
}
