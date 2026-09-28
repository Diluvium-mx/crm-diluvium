// Pastilla "WhatsApp" del Dashboard (pura). Decide color y textos con lo que
// el monitoreo dejó en Redis; la página nunca llama a Zernio al cargar.
//   verde  "WhatsApp conectado"
//   ámbar  "WhatsApp: revisar"
//   rojo   "WhatsApp desconectado desde HH:MM" (hora de Mazatlán)
//   gris   "Sin revisar desde HH:MM" si la última revisión tiene más de 15 min
import { mazatlanTime, type AccountState } from "./zernio-account";

export const STALE_AFTER_MS = 15 * 60_000;
/** El worker late cada minuto; más de 5 min sin latido = inactivo (mismo umbral que el monitoreo). */
export const WORKER_ALIVE_MS = 5 * 60_000;
/** La Action revisa el webhook cada 15 min (GitHub a veces se retrasa): más de 1 h = sin revisar. */
export const WEBHOOK_STALE_MS = 60 * 60_000;

export type PillTone = "green" | "amber" | "red" | "gray";
export type StatusLine = { label: string; value: string; tone: PillTone | "neutral" };
/** Forma común de las pastillas del Dashboard ("WhatsApp" y "Bot", ./bot-status.ts). */
export type PillStatus = { tone: PillTone; label: string; lines: StatusLine[] };
export type WhatsappStatus = PillStatus;

/** Lo que guarda /api/health/inbound en Redis (ZERNIO_WEBHOOK_KEY). */
export type WebhookSnapshot = {
  checkedAt: string;
  /** null = no se pudo revisar (Zernio no respondió o no hay webhook para este entorno). */
  webhook: { isActive: boolean; failureCount: number } | null;
};

function ago(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} días`;
}

function numberLine(state: AccountState | null, now: Date): Pick<StatusLine, "value" | "tone"> {
  const t = (iso: string | null) => (iso ? mazatlanTime(new Date(iso), now) : "");
  if (!state) return { value: "sin revisar", tone: "gray" };
  if (now.getTime() - Date.parse(state.checkedAt) > STALE_AFTER_MS) {
    return { value: `sin revisar desde ${t(state.checkedAt)}`, tone: "gray" };
  }
  const has = (r: AccountState["reasons"][number]) => state.reasons.includes(r);
  if (state.level === "down") {
    const since = state.downSince ? ` desde ${t(state.downSince)}` : "";
    if (has("no_existe")) return { value: `ya no está conectado en Zernio${since}`, tone: "red" };
    if (has("desconectado")) return { value: `desconectado${since}`, tone: "red" };
    if (has("webhook_no_suscrito")) return { value: `no recibe mensajes de Meta (reconectar)${since}`, tone: "red" };
    return { value: `Zernio lo marca con error${since}`, tone: "red" };
  }
  if (state.level === "warning") {
    const parts: string[] = [];
    if (has("desconexion_breve")) parts.push(`se desconectó a las ${t(state.eventAt)} y ya volvió`);
    if (has("inactividad_celular")) parts.push("abre la app de WhatsApp Business en el celular");
    if (has("estado_advertencia")) parts.push("Zernio lo marca con advertencia");
    return { value: `conectado; ${parts.join("; ")}`, tone: "amber" };
  }
  return { value: "conectado", tone: "green" };
}

function webhookLine(snapshot: WebhookSnapshot | null, now: Date): Pick<StatusLine, "value" | "tone"> {
  if (!snapshot) return { value: "sin revisar", tone: "gray" };
  const at = mazatlanTime(new Date(snapshot.checkedAt), now);
  if (now.getTime() - Date.parse(snapshot.checkedAt) > WEBHOOK_STALE_MS) return { value: `sin revisar desde ${at}`, tone: "gray" };
  const hook = snapshot.webhook;
  if (!hook) return { value: `no se pudo revisar (${at})`, tone: "amber" };
  const fallos = `${hook.failureCount} ${hook.failureCount === 1 ? "fallo" : "fallos"}`;
  if (!hook.isActive) return { value: `DESACTIVADO · ${fallos} (${at})`, tone: "red" };
  return { value: `activo · ${fallos} (${at})`, tone: hook.failureCount > 0 ? "amber" : "green" };
}

export function whatsappStatus(input: {
  now: Date;
  /** Canales de la organización que se vigilan (activos, no archivados). */
  channels: { id: string; displayName: string }[];
  /** Filas guardadas por el monitoreo (null: nunca revisado o Redis no respondió). */
  accounts: AccountState[] | null;
  lastInboundAt: Date | null;
  workerHeartbeatAt: Date | null;
  webhook: WebhookSnapshot | null;
}): WhatsappStatus | null {
  const { now } = input;
  if (input.channels.length === 0) return null;
  const byId = new Map((input.accounts ?? []).map((a) => [a.channelId, a]));
  const rows = input.channels.map((c) => ({ channel: c, state: byId.get(c.id) ?? null }));
  const t = (iso: string) => mazatlanTime(new Date(iso), now);

  let tone: PillTone;
  let label: string;
  const stale = rows.filter((r) => !r.state || now.getTime() - Date.parse(r.state.checkedAt) > STALE_AFTER_MS);
  const down = rows.flatMap((r) => (r.state?.level === "down" ? [r.state] : []));
  if (stale.length > 0) {
    const checked = stale.flatMap((r) => (r.state ? [r.state.checkedAt] : []));
    const oldest = checked.length === stale.length ? checked.sort()[0] : null;
    tone = "gray";
    label = oldest ? `Sin revisar desde ${t(oldest)}` : "Sin revisar";
  } else if (down.length > 0) {
    const since = down.map((s) => s.downSince).filter((d): d is string => d !== null).sort()[0];
    tone = "red";
    label = since ? `WhatsApp desconectado desde ${t(since)}` : "WhatsApp desconectado";
  } else if (rows.some((r) => r.state?.level === "warning")) {
    tone = "amber";
    label = "WhatsApp: revisar";
  } else {
    tone = "green";
    label = "WhatsApp conectado";
  }

  const single = rows.length === 1;
  const lines: StatusLine[] = rows.map((r) => ({
    label: single ? "Número" : `Número ${r.channel.displayName}`,
    ...numberLine(r.state, now),
  }));
  lines.push({
    label: "Último mensaje de un cliente",
    value: input.lastInboundAt ? ago(input.lastInboundAt, now) : "ninguno todavía",
    tone: "neutral",
  });
  const beat = input.workerHeartbeatAt;
  lines.push({
    label: "Worker",
    ...(beat && now.getTime() - beat.getTime() <= WORKER_ALIVE_MS
      ? { value: "activo", tone: "green" as const }
      : { value: beat ? `inactivo desde ${t(beat.toISOString())}` : "inactivo (sin latido)", tone: "red" as const }),
  });
  lines.push({ label: "Webhook de Zernio", ...webhookLine(input.webhook, now) });

  return { tone, label, lines };
}
