// Alarma de desconexión: leer la respuesta de Zernio y decidir el estado de la
// cuenta. Fixtures = respuesta REAL del 27-sep-2026 (sin llaves, teléfono ni ids reales).
import { describe, expect, it } from "vitest";
import healthFixture from "./__fixtures__/zernio-account-health.json";
import eventsFixture from "./__fixtures__/zernio-account-events.json";
import {
  accountProblems,
  evaluateAccount,
  mazatlanTime,
  parseAccountEvents,
  parseAccountHealth,
  summarizeAccounts,
  type AccountEvaluation,
  type AccountEvent,
  type AccountHealth,
  type AccountOutcome,
  type AccountState,
  uncheckedAccountsProblem,
} from "./zernio-account";

const NOW = new Date("2026-09-27T17:00:00Z"); // 27-sep 10:00 Mazatlán
const BASELINE = new Date("2026-09-27T16:30:00Z"); // primera revisión

const healthy: AccountHealth = { status: "healthy", connection: "connected", webhookSubscribed: true, primaryInactivity: false };

function withHealth(patch: Record<string, unknown>, connection: Record<string, unknown> = {}) {
  return {
    ...healthFixture,
    ...patch,
    platformConnection: { ...healthFixture.platformConnection, ...connection },
  };
}

function evaluate(opts: {
  health?: AccountHealth;
  notFound?: boolean;
  events?: AccountEvent[] | null;
  previous?: AccountState | null;
  alertAfter?: Date | null;
  now?: Date;
}) {
  return evaluateAccount({
    channelId: "ch_1",
    organizationId: "org_1",
    read: opts.notFound ? { kind: "not_found" } : { kind: "ok", health: opts.health ?? healthy, events: opts.events ?? [] },
    previous: opts.previous ?? null,
    baselineAt: BASELINE,
    alertAfter: opts.alertAfter ?? null,
    now: opts.now ?? NOW,
  });
}

describe("leer la respuesta de Zernio", () => {
  it("health real del oficial: conectado, webhook suscrito, sin inactividad", () => {
    expect(parseAccountHealth(healthFixture)).toEqual(healthy);
  });

  it("health desconectado / webhook no suscrito / error / inactividad en issues", () => {
    expect(parseAccountHealth(withHealth({ status: "error" }, { status: "disconnected", inboundWebhookSubscribed: null }))).toEqual({
      status: "error",
      connection: "disconnected",
      webhookSubscribed: null,
      primaryInactivity: false,
    });
    expect(parseAccountHealth(withHealth({}, { inboundWebhookSubscribed: false }))?.webhookSubscribed).toBe(false);
    expect(
      parseAccountHealth(withHealth({ status: "warning", issues: ["Meta: PRIMARY_INACTIVITY — open the app"] }))?.primaryInactivity,
    ).toBe(true);
  });

  it("forma irreconocible = null (no se pudo revisar, no desconectado)", () => {
    expect(parseAccountHealth({ error: "Account not found" })).toBeNull();
    expect(parseAccountHealth(null)).toBeNull();
    expect(parseAccountHealth("html de error")).toBeNull();
  });

  it("eventos reales: el ACCOUNT_OFFBOARDED del 27-sep 01:27Z es una desconexión", () => {
    expect(parseAccountEvents(eventsFixture)).toEqual([{ kind: "disconnect", at: new Date("2026-09-27T01:27:53.594Z") }]);
  });

  it("eventos: PRIMARY_INACTIVITY es inactividad; plantillas y basura se ignoran", () => {
    const events = parseAccountEvents({
      events: [
        { id: "1", type: "account_updated", title: "Primary inactivity", detail: "Coexistence (PRIMARY_INACTIVITY)", createdAt: "2026-09-27T16:40:00Z" },
        { id: "2", type: "template_approved", title: "Template approved", detail: null, createdAt: "2026-09-27T16:41:00Z" },
        { id: "3", type: "account_disconnected", createdAt: "no es fecha" },
        { nada: true },
      ],
    });
    expect(events).toEqual([{ kind: "inactivity", at: new Date("2026-09-27T16:40:00Z") }]);
    expect(parseAccountEvents({ error: "WhatsApp account not found" })).toBeNull();
  });
});

describe("decidir el estado de la cuenta", () => {
  const offboarded = parseAccountEvents(eventsFixture);

  it("27-sep real: conectado y el OFFBOARDED es anterior a la primera revisión → verde, sin aviso", () => {
    const { state, newEvents } = evaluate({ events: offboarded });
    expect(state.level).toBe("ok");
    expect(state.reasons).toEqual([]);
    expect(newEvents).toEqual([]);
    expect(state.lastConnectedAt).toBe(NOW.toISOString());
  });

  it.each([
    ["no connected", { ...healthy, connection: "disconnected" }, "desconectado"],
    ["unknown (lectura de Meta falló) también es rojo", { ...healthy, connection: "unknown" }, "desconectado"],
    ["webhook de Meta no suscrito", { ...healthy, webhookSubscribed: false }, "webhook_no_suscrito"],
    ["status error", { ...healthy, status: "error" }, "estado_error"],
  ] as const)("rojo: %s", (_name, health, reason) => {
    const { state } = evaluate({ health });
    expect(state.level).toBe("down");
    expect(state.reasons).toContain(reason);
  });

  it("webhookSubscribed null (sin dato) NO es rojo", () => {
    expect(evaluate({ health: { ...healthy, webhookSubscribed: null } }).state.level).toBe("ok");
  });

  it("404: la cuenta ya no está en Zernio → rojo", () => {
    const { state } = evaluate({ notFound: true });
    expect(state).toMatchObject({ level: "down", reasons: ["no_existe"], downSince: NOW.toISOString() });
  });

  it("'desde' = evento de desconexión posterior a la última vez conectada, aunque sea anterior al baseline", () => {
    const { state } = evaluate({ health: { ...healthy, connection: "disconnected" }, events: offboarded });
    expect(state.downSince).toBe("2026-09-27T01:27:53.594Z");
  });

  it("'desde' ignora eventos anteriores a la última vez que se vio conectada y se conserva mientras siga caída", () => {
    const previous = evaluate({ now: new Date("2026-09-27T16:55:00Z") }).state; // conectada a las 16:55
    const first = evaluate({ health: { ...healthy, connection: "disconnected" }, events: offboarded, previous });
    expect(first.state.downSince).toBe(NOW.toISOString());
    const later = evaluate({
      health: { ...healthy, connection: "disconnected" },
      events: offboarded,
      previous: first.state,
      now: new Date("2026-09-27T17:05:00Z"),
    });
    expect(later.state.downSince).toBe(NOW.toISOString());
    expect(later.state.lastConnectedAt).toBe("2026-09-27T16:55:00.000Z");
  });

  it("ámbar: status warning", () => {
    const { state } = evaluate({ health: { ...healthy, status: "warning" } });
    expect(state).toMatchObject({ level: "warning", reasons: ["estado_advertencia"] });
  });

  it("ámbar: PRIMARY_INACTIVITY en health (se avisa en cada revisión)", () => {
    const evaluation = evaluate({ health: { ...healthy, primaryInactivity: true } });
    expect(evaluation.state.reasons).toEqual(["inactividad_celular"]);
    expect(evaluation.healthInactivity).toBe(true);
  });

  it("desconexión nueva entre revisiones y ya conectado → ámbar 'ya volvió', avisada UNA vez", () => {
    const blip: AccountEvent[] = [{ kind: "disconnect", at: new Date("2026-09-27T16:58:00Z") }];
    const first = evaluate({ events: blip, alertAfter: new Date("2026-09-27T16:55:00Z") });
    expect(first.state).toMatchObject({ level: "warning", reasons: ["desconexion_breve"], eventAt: "2026-09-27T16:58:00.000Z" });
    expect(first.newEvents).toEqual([{ kind: "disconnect", at: "2026-09-27T16:58:00.000Z" }]);
    const next = evaluate({ events: blip, alertAfter: NOW, now: new Date("2026-09-27T17:05:00Z") });
    expect(next.state.level).toBe("warning"); // la pastilla la sigue mostrando
    expect(next.newEvents).toEqual([]); // pero ya no vuelve a alertar
  });

  it("la desconexión breve deja de pintar ámbar a las 24 h", () => {
    const blip: AccountEvent[] = [{ kind: "disconnect", at: new Date("2026-09-27T16:58:00Z") }];
    expect(evaluate({ events: blip, now: new Date("2026-09-28T17:00:00Z") }).state.level).toBe("ok");
  });

  it("inactividad por evento: ámbar y aviso una vez", () => {
    const events: AccountEvent[] = [{ kind: "inactivity", at: new Date("2026-09-27T16:45:00Z") }];
    const { state, newEvents, healthInactivity } = evaluate({ events });
    expect(state.reasons).toEqual(["inactividad_celular"]);
    expect(newEvents).toEqual([{ kind: "inactivity", at: "2026-09-27T16:45:00.000Z" }]);
    expect(healthInactivity).toBe(false);
  });

  it("si está caída, el evento de desconexión no se avisa aparte (ya lo dice el rojo)", () => {
    const events: AccountEvent[] = [{ kind: "disconnect", at: new Date("2026-09-27T16:58:00Z") }];
    const { state, newEvents } = evaluate({ health: { ...healthy, connection: "disconnected" }, events });
    expect(state.level).toBe("down");
    expect(newEvents).toEqual([]);
  });
});

describe("problemas para el log y el issue (repo público)", () => {
  const checked = (state: Partial<AccountState>, extra: Partial<AccountEvaluation> = {}): AccountOutcome => ({
    kind: "checked",
    evaluation: {
      state: {
        channelId: "ch_zernio_6ab86f30ed17823d8a280cab",
        organizationId: "org_1",
        level: "ok",
        reasons: [],
        checkedAt: NOW.toISOString(),
        downSince: null,
        lastConnectedAt: null,
        eventAt: null,
        ...state,
      },
      newEvents: [],
      healthInactivity: false,
      ...extra,
    },
  });

  it("rojo con hora de Mazatlán; nunca ids, números ni nombres", () => {
    const problems = accountProblems(
      [checked({ level: "down", reasons: ["desconectado"], downSince: "2026-09-27T16:40:00Z" })],
      NOW,
    );
    expect(problems).toEqual(["WhatsApp DESCONECTADO: 1 número(s) sin conexión con Meta/Zernio desde las 09:40 (Mazatlán)"]);
    expect(problems.join(" ")).not.toMatch(/ch_|6ab86f30|\d{10}|Diluvium/);
  });

  it("sano: sin problemas; resumen por conteos", () => {
    const outcomes = [checked({})];
    expect(accountProblems(outcomes, NOW)).toEqual([]);
    expect(summarizeAccounts(outcomes)).toEqual({ checked: 1, ok: 1, warning: 0, down: 0, unchecked: 0 });
  });

  it("Zernio no respondió → 'no se pudo revisar' APARTE (alerta solo si se repite), nunca 'desconectado'", () => {
    const outcomes: AccountOutcome[] = [{ kind: "unchecked", error: "Zernio no respondió en 10 s" }];
    expect(accountProblems(outcomes, NOW)).toEqual([]);
    const unchecked = uncheckedAccountsProblem(outcomes);
    expect(unchecked).toBe("no se pudo revisar 1 cuenta(s) de WhatsApp en Zernio: Zernio no respondió en 10 s");
    expect(unchecked).not.toMatch(/DESCONECTADO/i);
    expect(uncheckedAccountsProblem([])).toBeNull();
    expect(summarizeAccounts(outcomes)).toMatchObject({ down: 0, unchecked: 1 });
  });

  it("avisos por evento: desconexión breve e inactividad", () => {
    const problems = accountProblems(
      [
        checked(
          { level: "warning", reasons: ["desconexion_breve"] },
          { newEvents: [{ kind: "disconnect", at: "2026-09-27T16:58:00Z" }], healthInactivity: false },
        ),
      ],
      NOW,
    );
    expect(problems).toEqual(["WhatsApp: el número se desconectó a las 09:58 (Mazatlán) y ya volvió"]);
  });

  it("webhook de Meta no suscrito y advertencia", () => {
    const problems = accountProblems(
      [checked({ level: "down", reasons: ["webhook_no_suscrito"] }), checked({ level: "warning", reasons: ["estado_advertencia"] })],
      NOW,
    );
    expect(problems).toEqual([
      "WhatsApp: Meta no le manda los mensajes a Zernio (webhook no suscrito) en 1 número(s): reconectar",
      "WhatsApp: Zernio marca 1 cuenta(s) con advertencia",
    ]);
  });
});

describe("hora de Mazatlán", () => {
  it("hoy solo HH:MM; otro día con fecha", () => {
    expect(mazatlanTime(new Date("2026-09-27T16:40:00Z"), NOW)).toBe("09:40");
    expect(mazatlanTime(new Date("2026-09-27T01:27:53Z"), NOW)).toBe("26 sep 18:27");
  });
});
