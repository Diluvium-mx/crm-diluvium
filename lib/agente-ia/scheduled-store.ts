// Cambios del Goal y las FAQs programados para las 22:00 (9-oct-2026, regla del dueño). Sin
// sesión: las Server Actions (lib/actions/agente-ia-scheduled.ts) resuelven organización y
// permiso; el worker aplica lo que ya toca (applyDueScheduled, barrido de cada minuto). Toda
// consulta filtra por organization_id. Reglas puras: scheduled-rules.ts.
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiScheduledChanges, user, type ScheduledFaq } from "@/lib/db/schema";
import { EditorNotFoundError, liveFaqs, liveGoal, versionSnapshot, writeFaqs, writeGoal } from "./editor-store";
import { applyAtFor, normalizeFaqs, sameFaqs, type FaqItem } from "./scheduled-rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Nombre de la versión que deja lo programado al aplicarse a las 22:00. */
export const VERSION_AT_22 = "Programado para las 22:00";
/** …y cuando alguien lo aplica antes con «Aplicar ahora». */
export const VERSION_NOW = "Programado, aplicado antes de las 22:00";

export type ScheduledRow = typeof aiScheduledChanges.$inferSelect & { author: string | null };

export async function loadScheduled(organizationId: string): Promise<ScheduledRow | null> {
  const [row] = await db
    .select({ s: aiScheduledChanges, author: user.name })
    .from(aiScheduledChanges)
    .leftJoin(user, eq(user.id, aiScheduledChanges.updatedByUserId))
    .where(eq(aiScheduledChanges.organizationId, organizationId))
    .limit(1);
  return row ? { ...row.s, author: row.author } : null;
}

async function lockRow(tx: Tx, organizationId: string) {
  const [row] = await tx.select().from(aiScheduledChanges).where(eq(aiScheduledChanges.organizationId, organizationId)).for("update");
  return row ?? null;
}

// Guarda una parte (Goal o FAQs) de lo programado. `null` en esa parte = ya no cambia (quedó
// igual a lo que está en vivo). Sin ninguna parte, la fila se borra.
async function upsertPart(
  tx: Tx,
  organizationId: string,
  userId: string | null,
  now: Date,
  part: { goal: string | null; baseGoal: string | null } | { faqs: ScheduledFaq[] | null; baseFaqs: ScheduledFaq[] | null },
): Promise<void> {
  const row = await lockRow(tx, organizationId);
  const next = {
    goal: row?.goal ?? null,
    baseGoal: row?.baseGoal ?? null,
    faqs: row?.faqs ?? null,
    baseFaqs: row?.baseFaqs ?? null,
    ...part,
  };
  if (next.goal === null && next.faqs === null) {
    if (row) await tx.delete(aiScheduledChanges).where(eq(aiScheduledChanges.organizationId, organizationId));
    return;
  }
  const values = { ...next, applyAt: applyAtFor(now), updatedByUserId: userId, updatedAt: now };
  if (row) {
    await tx.update(aiScheduledChanges).set(values).where(eq(aiScheduledChanges.organizationId, organizationId));
  } else {
    await tx.insert(aiScheduledChanges).values({ organizationId, ...values, createdByUserId: userId, createdAt: now });
  }
}

/** Programa el Goal. Si queda igual al que está en vivo, esa parte se quita. */
export async function scheduleGoal(organizationId: string, userId: string | null, goal: string, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const live = await liveGoal(tx, organizationId);
    const row = await lockRow(tx, organizationId);
    const base = row?.goal != null ? (row.baseGoal ?? live) : live;
    await upsertPart(tx, organizationId, userId, now, goal === live ? { goal: null, baseGoal: null } : { goal, baseGoal: base });
  });
}

/** Programa la lista completa de FAQs. Si queda igual a la que está en vivo, esa parte se quita. */
export async function scheduleFaqs(organizationId: string, userId: string | null, list: readonly FaqItem[], now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const live = await liveFaqs(tx, organizationId);
    const row = await lockRow(tx, organizationId);
    const base = row?.faqs != null ? (row.baseFaqs ?? live) : live;
    const faqs = normalizeFaqs(list);
    await upsertPart(tx, organizationId, userId, now, sameFaqs(faqs, live) ? { faqs: null, baseFaqs: null } : { faqs, baseFaqs: normalizeFaqs(base) });
  });
}

/** Programa una versión anterior (Goal o FAQs) en vez de restaurarla al momento. */
export async function scheduleVersion(organizationId: string, userId: string | null, kind: "goal" | "faqs", versionId: string, now: Date = new Date()): Promise<void> {
  const snap = await versionSnapshot(organizationId, kind, versionId);
  if (kind === "goal") {
    const goal = typeof snap.goal === "string" ? snap.goal : "";
    if (!goal.trim()) throw new EditorNotFoundError("Esa versión no tiene Goal.");
    await scheduleGoal(organizationId, userId, goal, now);
    return;
  }
  const raw = Array.isArray(snap.faqs) ? (snap.faqs as { question?: unknown; answer?: unknown; enabled?: unknown; position?: unknown }[]) : [];
  const list = raw.map((f, i) => ({
    id: crypto.randomUUID(),
    question: String(f.question ?? ""),
    answer: String(f.answer ?? ""),
    enabled: f.enabled !== false,
    position: typeof f.position === "number" && Number.isFinite(f.position) ? f.position : i + 1,
  }));
  await scheduleFaqs(organizationId, userId, list, now);
}

/** Quita lo programado (una parte o todo). */
export async function cancelScheduled(organizationId: string, part: "goal" | "faqs" | "todo", userId: string | null, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    if (part === "todo") {
      await tx.delete(aiScheduledChanges).where(eq(aiScheduledChanges.organizationId, organizationId));
      return;
    }
    await upsertPart(tx, organizationId, userId, now, part === "goal" ? { goal: null, baseGoal: null } : { faqs: null, baseFaqs: null });
  });
}

/**
 * Tras un guardado «Ahora»: quita de lo programado lo que ya quedó igual en vivo (p. ej. se guardó
 * ahora mismo el texto que estaba programado), para que el aviso no muestre un cambio que ya está.
 */
export async function pruneScheduled(organizationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockRow(tx, organizationId);
    if (!row) return;
    const goalDone = row.goal !== null && row.goal === (await liveGoal(tx, organizationId));
    const faqsDone = row.faqs !== null && sameFaqs(row.faqs, await liveFaqs(tx, organizationId));
    if (!goalDone && !faqsDone) return;
    const goal = goalDone ? null : row.goal;
    const faqs = faqsDone ? null : row.faqs;
    if (goal === null && faqs === null) {
      await tx.delete(aiScheduledChanges).where(eq(aiScheduledChanges.organizationId, organizationId));
      return;
    }
    await tx
      .update(aiScheduledChanges)
      .set({ goal, baseGoal: goalDone ? null : row.baseGoal, faqs, baseFaqs: faqsDone ? null : row.baseFaqs })
      .where(eq(aiScheduledChanges.organizationId, organizationId));
  });
}

export type ApplyResult = { kind: "aplicado" } | { kind: "conflicto"; message: string } | { kind: "nada" };

/**
 * Aplica lo programado en UNA transacción: el Goal y las FAQs con una versión cada uno (nombre
 * `versionName`) y la fila se borra. Si lo que está en vivo cambió después de programarlo (alguien
 * guardó «Ahora»), no lo pisa: la fila queda en «conflicto» con el motivo, salvo `force`.
 */
export async function applyScheduled(
  organizationId: string,
  opts: { userId: string | null; force?: boolean; versionName?: string },
): Promise<ApplyResult> {
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, organizationId);
    if (!row) return { kind: "nada" } as const;
    const goalLive = await liveGoal(tx, organizationId);
    const faqsLive = await liveFaqs(tx, organizationId);
    // Una parte que ya quedó igual en vivo no choca: ya está aplicada.
    const goalPending = row.goal !== null && row.goal !== goalLive;
    const faqsPending = row.faqs !== null && !sameFaqs(row.faqs, faqsLive);
    const problems = [
      goalPending && row.baseGoal !== null && row.baseGoal !== goalLive ? "el Goal" : null,
      faqsPending && row.baseFaqs !== null && !sameFaqs(row.baseFaqs, faqsLive) ? "las FAQs" : null,
    ].filter(Boolean);
    if (problems.length && !opts.force) {
      const message = `${problems.join(" y ")} cambiaron después de programarlo (alguien guardó «Ahora»). No se aplicó para no borrar ese cambio.`;
      await tx.update(aiScheduledChanges).set({ status: "conflicto", conflict: message }).where(eq(aiScheduledChanges.organizationId, organizationId));
      return { kind: "conflicto", message } as const;
    }
    const name = opts.versionName ?? VERSION_AT_22;
    if (goalPending && row.goal !== null) await writeGoal(tx, organizationId, opts.userId, row.goal, name);
    if (faqsPending && row.faqs !== null) await writeFaqs(tx, organizationId, opts.userId, row.faqs, name);
    await tx.delete(aiScheduledChanges).where(eq(aiScheduledChanges.organizationId, organizationId));
    return { kind: "aplicado" } as const;
  });
}

/** Barrido del worker: aplica todo lo programado cuya hora ya llegó. Devuelve qué pasó por organización. */
export async function applyDueScheduled(now: Date = new Date()): Promise<{ organizationId: string; result: ApplyResult }[]> {
  const due = await db
    .select({ organizationId: aiScheduledChanges.organizationId, userId: aiScheduledChanges.updatedByUserId })
    .from(aiScheduledChanges)
    .where(and(eq(aiScheduledChanges.status, "programado"), lte(aiScheduledChanges.applyAt, now)));
  const out: { organizationId: string; result: ApplyResult }[] = [];
  for (const d of due) {
    out.push({ organizationId: d.organizationId, result: await applyScheduled(d.organizationId, { userId: d.userId }) });
  }
  return out;
}
