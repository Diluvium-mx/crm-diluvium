"use server";

// Mensajes programados (A6): capa delgada sobre lib/scheduled/store.ts. Resuelve
// la organización y el usuario desde la sesión (nunca del cliente), valida la
// entrada con Zod y encola el job diferido DESPUÉS de guardar la fila. Permiso:
// cualquier miembro (el agente es el vendedor y lo usa a diario).
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { enqueueScheduled, removeScheduledJob } from "@/lib/queue/scheduled";
import { localToInstant } from "@/lib/scheduled/rules";
import {
  cancelScheduled,
  createScheduled,
  listScheduledForConversation,
  retryScheduled,
  ScheduleError,
  updateScheduled,
} from "@/lib/scheduled/store";
import type { ScheduledView, ScheduleEditInput, ScheduleInput, ScheduleResult } from "@/lib/scheduled/types";

const id = z.string().trim().min(1);
const local = z.string().trim();

const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    conversationId: id,
    kind: z.literal("text"),
    text: z.string(),
    sendAtLocal: local,
    cancelIfInbound: z.boolean(),
  }),
  z.object({
    conversationId: id,
    kind: z.literal("template"),
    templateId: id,
    templateParams: z.array(z.string()).max(50),
    sendAtLocal: local,
    cancelIfInbound: z.boolean(),
  }),
]);

const editSchema = z.object({
  sendAtLocal: local,
  cancelIfInbound: z.boolean(),
  text: z.string().optional(),
});

async function run(action: () => Promise<void>): Promise<ScheduleResult> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    if (error instanceof ScheduleError) return { ok: false, message: error.message };
    if (error instanceof z.ZodError) return { ok: false, message: "Datos inválidos." };
    throw error;
  }
}

export async function listScheduledMessages(conversationId: string): Promise<ScheduledView[]> {
  const { organizationId } = await requireActiveMembership();
  return listScheduledForConversation(organizationId, id.parse(conversationId));
}

export async function scheduleMessage(input: ScheduleInput): Promise<ScheduleResult> {
  const { organizationId, userId } = await requireActiveMembership();
  return run(async () => {
    const parsed = scheduleSchema.parse(input);
    const common = {
      organizationId,
      userId,
      conversationId: parsed.conversationId,
      sendAt: localToInstant(parsed.sendAtLocal),
      cancelIfInbound: parsed.cancelIfInbound,
    };
    const row = await createScheduled(
      parsed.kind === "text"
        ? { ...common, kind: "text", text: parsed.text }
        : { ...common, kind: "template", templateId: parsed.templateId, templateParams: parsed.templateParams },
    );
    await enqueueScheduled(row.id, row.sendAt);
  });
}

export async function updateScheduledMessage(scheduledId: string, input: ScheduleEditInput): Promise<ScheduleResult> {
  const { organizationId } = await requireActiveMembership();
  return run(async () => {
    const parsed = editSchema.parse(input);
    const { before, after } = await updateScheduled({
      organizationId,
      id: id.parse(scheduledId),
      sendAt: localToInstant(parsed.sendAtLocal),
      cancelIfInbound: parsed.cancelIfInbound,
      text: parsed.text,
    });
    if (before.sendAt.getTime() !== after.sendAt.getTime()) {
      await removeScheduledJob(before.id, before.sendAt);
      await enqueueScheduled(after.id, after.sendAt);
    }
  });
}

/** Cancela uno pendiente; en uno fallido o cancelado por el cliente, lo quita de la vista. */
export async function cancelScheduledMessage(scheduledId: string): Promise<ScheduleResult> {
  const { organizationId } = await requireActiveMembership();
  return run(async () => {
    const row = await cancelScheduled(organizationId, id.parse(scheduledId));
    await removeScheduledJob(row.id, row.sendAt);
  });
}

export async function retryScheduledMessage(scheduledId: string): Promise<ScheduleResult> {
  const { organizationId } = await requireActiveMembership();
  return run(async () => {
    const row = await retryScheduled(organizationId, id.parse(scheduledId));
    await enqueueScheduled(row.id, row.sendAt);
  });
}
