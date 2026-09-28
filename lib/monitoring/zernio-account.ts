// Salud de la CUENTA de WhatsApp en Zernio (alarma de desconexión, 27-sep-2026).
// Lógica pura, sin red ni base: leer lo que devuelve Zernio y decidir el estado.
//
// Zernio (docs.zernio.com, revisado el 27-sep-2026; forma confirmada con una
// consulta real, fixtures en __fixtures__/zernio-account-*.json):
// - GET /v1/accounts/{id}/health → status healthy|warning|error y
//   platformConnection { status connected|disconnected|unknown,
//   inboundWebhookSubscribed true|false|null }. Es lectura EN VIVO a Meta.
// - GET /v1/whatsapp/account-events?accountId= → eventos de Meta que Zernio
//   guardó (p. ej. account_disconnected "…(ACCOUNT_OFFBOARDED)"); sin paginación.
//
// Reglas del dueño:
// - El estado ACTUAL lo decide health. Rojo: no "connected", webhook de Meta
//   no suscrito o status "error" (y 404: la cuenta ya no existe en Zernio).
//   Ámbar: status "warning" o PRIMARY_INACTIVITY (el celular lleva días sin
//   abrir la app de WhatsApp Business).
// - Los eventos avisan de una desconexión NUEVA ocurrida entre revisiones
//   (ámbar "se desconectó a las HH:MM y ya volvió") y dan el "desde HH:MM".
//   Los anteriores a la primera revisión (baseline) nunca alertan.
// - Si Zernio no responde es "no se pudo revisar", nunca "desconectado".
import { z } from "zod";

/** Un aviso por evento (desconexión breve, inactividad) se ve en ámbar 24 h. */
export const EVENT_WINDOW_MS = 24 * 60 * 60_000;

const healthSchema = z
  .object({
    status: z.string().nullish(),
    issues: z.array(z.unknown()).nullish(),
    platformConnection: z
      .object({
        status: z.string().nullish(),
        inboundWebhookSubscribed: z.boolean().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

const eventSchema = z
  .object({
    type: z.string(),
    title: z.string().nullish(),
    detail: z.string().nullish(),
    createdAt: z.string(),
  })
  .passthrough();

export type AccountHealth = {
  status: string | null;
  connection: string | null;
  webhookSubscribed: boolean | null;
  primaryInactivity: boolean;
};

export type AccountEvent = { kind: "disconnect" | "inactivity"; at: Date };

const INACTIVITY = /PRIMARY_INACTIVITY/i;

/** Lee la respuesta de health. null = forma irreconocible ("no se pudo revisar"). */
export function parseAccountHealth(json: unknown): AccountHealth | null {
  const parsed = healthSchema.safeParse(json);
  if (!parsed.success) return null;
  const { status, issues, platformConnection } = parsed.data;
  return {
    status: status ?? null,
    connection: platformConnection.status ?? null,
    webhookSubscribed: platformConnection.inboundWebhookSubscribed ?? null,
    primaryInactivity: (issues ?? []).some((issue) => INACTIVITY.test(JSON.stringify(issue))),
  };
}

/** Solo los eventos que importan a la alarma; los demás (plantillas, etc.) se ignoran. */
export function parseAccountEvents(json: unknown): AccountEvent[] | null {
  const list = z.object({ events: z.array(z.unknown()) }).safeParse(json);
  if (!list.success) return null;
  const events: AccountEvent[] = [];
  for (const raw of list.data.events) {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) continue;
    const at = new Date(parsed.data.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const text = `${parsed.data.type} ${parsed.data.title ?? ""} ${parsed.data.detail ?? ""}`;
    if (INACTIVITY.test(text)) events.push({ kind: "inactivity", at });
    else if (parsed.data.type === "account_disconnected" || /OFFBOARDED|DISCONNECT/i.test(text)) {
      events.push({ kind: "disconnect", at });
    }
  }
  return events;
}

export type AccountLevel = "ok" | "warning" | "down";

export type AccountReason =
  | "desconectado" // platformConnection.status distinto de "connected"
  | "webhook_no_suscrito" // Meta no le manda los mensajes a Zernio
  | "estado_error"
  | "no_existe" // Zernio responde 404: la cuenta ya no está conectada ahí
  | "estado_advertencia"
  | "inactividad_celular" // PRIMARY_INACTIVITY
  | "desconexion_breve"; // evento de desconexión nuevo y health ya conectado

/** Lo que se guarda en Redis por canal (última revisión EXITOSA). */
export type AccountState = {
  channelId: string;
  organizationId: string;
  level: AccountLevel;
  reasons: AccountReason[];
  checkedAt: string;
  downSince: string | null;
  lastConnectedAt: string | null;
  /** Hora del evento que explica el ámbar (desconexión breve o inactividad). */
  eventAt: string | null;
};

export type AccountRead = { kind: "ok"; health: AccountHealth; events: AccountEvent[] | null } | { kind: "not_found" };

export type AccountEvaluation = {
  state: AccountState;
  /** Eventos posteriores a la revisión anterior de quien revisa: se avisan UNA vez. */
  newEvents: { kind: AccountEvent["kind"]; at: string }[];
  /** health reporta PRIMARY_INACTIVITY: se avisa en CADA revisión mientras siga. */
  healthInactivity: boolean;
};

export function evaluateAccount(input: {
  channelId: string;
  organizationId: string;
  read: AccountRead;
  previous: AccountState | null;
  /** Primera revisión registrada: eventos anteriores no alertan. */
  baselineAt: Date;
  /** Revisión anterior de este mismo vigilante (worker o web); sin ella, el baseline. */
  alertAfter: Date | null;
  now: Date;
}): AccountEvaluation {
  const { read, previous, baselineAt, now } = input;
  const events = read.kind === "ok" ? (read.events ?? []) : [];
  const reasons: AccountReason[] = [];

  if (read.kind === "not_found") reasons.push("no_existe");
  else {
    const h = read.health;
    if (h.connection !== "connected") reasons.push("desconectado");
    if (h.webhookSubscribed === false) reasons.push("webhook_no_suscrito");
    if (h.status === "error") reasons.push("estado_error");
  }
  const down = reasons.length > 0;

  const recent = (e: AccountEvent) => e.at > baselineAt && now.getTime() - e.at.getTime() <= EVENT_WINDOW_MS;
  const latest = (list: AccountEvent[]) =>
    list.reduce<Date | null>((max, e) => (max === null || e.at > max ? e.at : max), null);

  let eventAt: Date | null = null;
  if (!down && read.kind === "ok") {
    if (read.health.status === "warning") reasons.push("estado_advertencia");
    const inactivity = latest(events.filter((e) => e.kind === "inactivity" && recent(e)));
    if (read.health.primaryInactivity || inactivity) reasons.push("inactividad_celular");
    const blip = latest(events.filter((e) => e.kind === "disconnect" && recent(e)));
    if (blip) reasons.push("desconexion_breve");
    eventAt = [inactivity, blip].reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null);
  }

  // "Desde": si ya estaba caída, se conserva; si no, el último evento de
  // desconexión posterior a la última vez que se vio conectada (aunque sea
  // anterior al baseline: no alerta, solo fecha) o, sin evento, esta revisión.
  let downSince: string | null = null;
  if (down) {
    if (previous?.level === "down" && previous.downSince) downSince = previous.downSince;
    else {
      const lastOk = previous?.lastConnectedAt ? new Date(previous.lastConnectedAt) : null;
      const cause = latest(events.filter((e) => e.kind === "disconnect" && (!lastOk || e.at > lastOk)));
      downSince = (cause ?? now).toISOString();
    }
  }

  const cursor = new Date(Math.max(baselineAt.getTime(), input.alertAfter?.getTime() ?? 0));
  const newEvents = events
    .filter((e) => e.at > cursor && (e.kind === "inactivity" || !down))
    .map((e) => ({ kind: e.kind, at: e.at.toISOString() }));

  return {
    state: {
      channelId: input.channelId,
      organizationId: input.organizationId,
      level: down ? "down" : reasons.length > 0 ? "warning" : "ok",
      reasons,
      checkedAt: now.toISOString(),
      downSince,
      lastConnectedAt: down ? (previous?.lastConnectedAt ?? null) : now.toISOString(),
      eventAt: eventAt?.toISOString() ?? null,
    },
    newEvents,
    healthInactivity: !down && read.kind === "ok" && read.health.primaryInactivity,
  };
}

/** Hora local de Mazatlán; si no es hoy, con día ("26 sep 23:10"). */
export function mazatlanTime(at: Date, now: Date): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(d);
  const time = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mazatlan",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  if (day(at) === day(now)) return time;
  const date = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mazatlan", day: "numeric", month: "short" })
    .format(at)
    .replace(".", "");
  return `${date} ${time}`;
}

export type AccountOutcome =
  | { kind: "checked"; evaluation: AccountEvaluation }
  | { kind: "unchecked"; error: string };

export type AccountsSummary = { checked: number; ok: number; warning: number; down: number; unchecked: number };

export function summarizeAccounts(outcomes: AccountOutcome[]): AccountsSummary {
  const summary: AccountsSummary = { checked: outcomes.length, ok: 0, warning: 0, down: 0, unchecked: 0 };
  for (const o of outcomes) {
    if (o.kind === "unchecked") summary.unchecked += 1;
    else summary[o.evaluation.state.level] += 1;
  }
  return summary;
}

/**
 * Problemas para el log y el issue `alerta-whatsapp` (repo PÚBLICO): solo
 * estados, conteos y horas; nunca números, nombres ni ids. Valen A CUALQUIER
 * HORA (no dependen del horario laboral, a diferencia del silencio).
 */
export function accountProblems(outcomes: AccountOutcome[], now: Date): string[] {
  const problems: string[] = [];
  const count = (pred: (s: AccountState) => boolean) =>
    outcomes.filter((o) => o.kind === "checked" && pred(o.evaluation.state)).length;
  const has = (r: AccountReason) => (s: AccountState) => s.reasons.includes(r);

  const downStates = outcomes.flatMap((o) => (o.kind === "checked" && o.evaluation.state.level === "down" ? [o.evaluation.state] : []));
  const disconnected = downStates.filter((s) => s.reasons.includes("desconectado") || s.reasons.includes("no_existe"));
  if (disconnected.length > 0) {
    const since = disconnected
      .map((s) => s.downSince)
      .filter((d): d is string => d !== null)
      .sort()[0];
    problems.push(
      `WhatsApp DESCONECTADO: ${disconnected.length} número(s) sin conexión con Meta/Zernio` +
        (since ? ` desde las ${mazatlanTime(new Date(since), now)} (Mazatlán)` : ""),
    );
  }
  const notSubscribed = count(has("webhook_no_suscrito"));
  if (notSubscribed > 0) problems.push(`WhatsApp: Meta no le manda los mensajes a Zernio (webhook no suscrito) en ${notSubscribed} número(s): reconectar`);
  const error = count(has("estado_error"));
  if (error > 0) problems.push(`WhatsApp: Zernio marca ${error} cuenta(s) con estado de error`);
  const warning = count(has("estado_advertencia"));
  if (warning > 0) problems.push(`WhatsApp: Zernio marca ${warning} cuenta(s) con advertencia`);
  const inactivityNow = outcomes.filter((o) => o.kind === "checked" && o.evaluation.healthInactivity).length;
  if (inactivityNow > 0) problems.push(`WhatsApp: el celular lleva días sin abrir la app de WhatsApp Business (${inactivityNow}): abrirla`);

  for (const o of outcomes) {
    if (o.kind !== "checked") continue;
    for (const e of o.evaluation.newEvents) {
      const at = mazatlanTime(new Date(e.at), now);
      problems.push(
        e.kind === "inactivity"
          ? `WhatsApp: aviso de Meta a las ${at} (Mazatlán): el celular lleva días sin abrir la app de WhatsApp Business; abrirla`
          : `WhatsApp: el número se desconectó a las ${at} (Mazatlán) y ya volvió`,
      );
    }
  }

  return problems;
}

/**
 * "No se pudo revisar" va APARTE de los problemas: solo alerta tras 2 revisiones seguidas
 * del mismo vigilante (uncheckedAlert en ./alert-rules.ts). Nunca es "desconectado".
 */
export function uncheckedAccountsProblem(outcomes: AccountOutcome[]): string | null {
  const unchecked = outcomes.filter((o) => o.kind === "unchecked");
  if (unchecked.length === 0) return null;
  const reasons = [...new Set(unchecked.map((o) => (o.kind === "unchecked" ? o.error : "")))].join("; ");
  return `no se pudo revisar ${unchecked.length} cuenta(s) de WhatsApp en Zernio: ${reasons}`;
}
