"use server";

// Server Actions del Agente IA (Fase A). Resuelven la organización activa desde
// la SESIÓN. `getAiConfig`/`updateAiConfig` leen/escriben la tabla `ai_config`;
// `probarModelo` corre un dry-run filtro→cerebro contra el proveedor real SIN
// tocar WhatsApp ni conversaciones. Gestionar la config es de owner/admin (ACL
// en lib/auth/permissions.ts); el agente (vendedor) no accede.
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { aiConfig } from "@/lib/db/schema";
import {
  callModel,
  ModelNotConfiguredError,
  ModelNotFoundError,
  ProviderNotImplementedError,
} from "@/lib/ai";
import { DEFAULT_BRAIN_MODEL, DEFAULT_FILTER_MODEL, getModel, modelsForRole } from "@/lib/ai/catalog";
import type { AiConfigView, DryRunStageView, ProbarModeloResultView } from "@/lib/agente-ia/types";

function requireAiConfigManage(role: string, action: "read" | "update"): void {
  if (!roleAllows(role, "aiConfig", action)) {
    throw new Error("No tienes permiso para la configuración del Agente IA; pídeselo a un administrador.");
  }
}

// Ids válidos por rol, tomados del catálogo (fuente única). Guardar un modelo
// que no corresponde a su rol se rechaza.
const filterModelIds = modelsForRole("filtro").map((m) => m.id);
const brainModelIds = modelsForRole("cerebro").map((m) => m.id);

const updateSchema = z.object({
  modeloFiltro: z.string().refine((id) => filterModelIds.includes(id), {
    message: "Modelo de filtro no válido.",
  }),
  modeloCerebro: z.string().refine((id) => brainModelIds.includes(id), {
    message: "Modelo de cerebro no válido.",
  }),
});
export type UpdateAiConfigInput = z.infer<typeof updateSchema>;

async function readConfig(organizationId: string): Promise<AiConfigView> {
  const [row] = await db.select().from(aiConfig).where(eq(aiConfig.organizationId, organizationId));
  return {
    modeloFiltro: row?.modeloFiltro ?? DEFAULT_FILTER_MODEL,
    modeloCerebro: row?.modeloCerebro ?? DEFAULT_BRAIN_MODEL,
  };
}

export async function getAiConfig(): Promise<AiConfigView> {
  const { organizationId, role } = await requireActiveMembership();
  requireAiConfigManage(role, "read");
  return readConfig(organizationId);
}

export async function updateAiConfig(input: UpdateAiConfigInput): Promise<AiConfigView> {
  const { organizationId, role } = await requireActiveMembership();
  requireAiConfigManage(role, "update");
  const parsed = updateSchema.parse(input);
  const now = new Date();
  await db
    .insert(aiConfig)
    .values({
      organizationId,
      modeloFiltro: parsed.modeloFiltro,
      modeloCerebro: parsed.modeloCerebro,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiConfig.organizationId,
      set: { modeloFiltro: parsed.modeloFiltro, modeloCerebro: parsed.modeloCerebro, updatedAt: now },
    });
  revalidatePath("/agente-ia");
  return { modeloFiltro: parsed.modeloFiltro, modeloCerebro: parsed.modeloCerebro };
}

// ── Dry-run "Probar modelo" ──────────────────────────────────────────────────
// Mensaje de ejemplo y systems de PRUEBA de la Fase A. El system real (Goal + 47
// FAQs) se cablea en la Fase B; aquí solo se verifica que cada modelo responde.
const SAMPLE_MESSAGE =
  "Hola, vi su anuncio en Facebook. ¿Manejan control de inundaciones para bodega y cuánto cuesta una cotización?";
const FILTER_TEST_SYSTEM =
  "Eres el filtro de una bandeja de ventas. Di en UNA sola línea si el mensaje del cliente requiere atención de un vendedor humano y por qué. (System de PRUEBA de la Fase A.)";
const BRAIN_TEST_SYSTEM =
  "Eres un asistente de ventas cordial de Diluvium (control de inundaciones). Responde breve, en español, al cliente. (System de PRUEBA de la Fase A; el system real —Goal + FAQs— llega en la Fase B.)";

function friendlyModelError(error: unknown): string {
  if (error instanceof ModelNotConfiguredError) {
    return `Falta la llave ${error.envKey}: agrégala en Railway (servicio web) para usar este modelo.`;
  }
  if (error instanceof ProviderNotImplementedError) {
    return "Este proveedor aún no tiene adaptador (llega en un brief siguiente).";
  }
  if (error instanceof ModelNotFoundError) {
    return "El modelo configurado ya no está en el catálogo; elige otro.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function runStage(stage: "filtro" | "cerebro", modelId: string, system: string): Promise<DryRunStageView> {
  const label = getModel(modelId)?.label ?? modelId;
  try {
    const result = await callModel(modelId, {
      system,
      messages: [{ role: "user", content: SAMPLE_MESSAGE }],
      maxOutputTokens: 300,
    });
    return { stage, modelId, label, ok: true, text: result.text, error: null, usage: result.usage };
  } catch (error) {
    return { stage, modelId, label, ok: false, text: null, error: friendlyModelError(error), usage: null };
  }
}

export async function probarModelo(): Promise<ProbarModeloResultView> {
  const { organizationId, role } = await requireActiveMembership();
  requireAiConfigManage(role, "update");
  const config = await readConfig(organizationId);
  // Secuencial filtro→cerebro (como será el pipeline real). Cada etapa captura
  // su propio error para que una falla no oculte el resultado de la otra.
  const filtro = await runStage("filtro", config.modeloFiltro, FILTER_TEST_SYSTEM);
  const cerebro = await runStage("cerebro", config.modeloCerebro, BRAIN_TEST_SYSTEM);
  return { stages: [filtro, cerebro] };
}
