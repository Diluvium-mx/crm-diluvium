// Pastilla "WhatsApp" del Dashboard: verde / ámbar / rojo / gris y las 4 líneas del recuadro.
import { describe, expect, it } from "vitest";
import { whatsappStatus, type WebhookSnapshot } from "./status-pill";
import type { AccountState } from "./zernio-account";

const NOW = new Date("2026-09-27T17:00:00Z"); // 10:00 Mazatlán
const CHANNEL = { id: "ch_1", displayName: "Diluvium" };

function state(patch: Partial<AccountState> = {}): AccountState {
  return {
    channelId: "ch_1",
    organizationId: "org_1",
    level: "ok",
    reasons: [],
    checkedAt: "2026-09-27T16:57:00Z",
    downSince: null,
    lastConnectedAt: "2026-09-27T16:57:00Z",
    eventAt: null,
    ...patch,
  };
}

const webhook: WebhookSnapshot = { checkedAt: "2026-09-27T16:50:00Z", webhook: { isActive: true, failureCount: 0 } };

function status(accounts: AccountState[] | null, extra: Partial<Parameters<typeof whatsappStatus>[0]> = {}) {
  return whatsappStatus({
    now: NOW,
    channels: [CHANNEL],
    accounts,
    lastInboundAt: new Date("2026-09-27T16:48:00Z"),
    workerHeartbeatAt: new Date("2026-09-27T16:59:30Z"),
    webhook,
    ...extra,
  });
}

describe("color y texto de la pastilla", () => {
  it("verde: conectado y revisado hace menos de 15 min", () => {
    expect(status([state()])).toMatchObject({ tone: "green", label: "WhatsApp conectado" });
  });

  it("ámbar: revisar (advertencia, inactividad o desconexión breve)", () => {
    const s = status([state({ level: "warning", reasons: ["desconexion_breve"], eventAt: "2026-09-27T16:10:00Z" })]);
    expect(s).toMatchObject({ tone: "amber", label: "WhatsApp: revisar" });
    expect(s?.lines[0]).toEqual({ label: "Número", value: "conectado; se desconectó a las 09:10 y ya volvió", tone: "amber" });
  });

  it("rojo: desconectado desde HH:MM (Mazatlán)", () => {
    const s = status([state({ level: "down", reasons: ["desconectado"], downSince: "2026-09-27T16:40:00Z" })]);
    expect(s).toMatchObject({ tone: "red", label: "WhatsApp desconectado desde 09:40" });
    expect(s?.lines[0]).toMatchObject({ value: "desconectado desde 09:40", tone: "red" });
  });

  it("rojo de otro día lleva la fecha", () => {
    const s = status([state({ level: "down", reasons: ["no_existe"], downSince: "2026-09-27T01:27:53Z" })]);
    expect(s?.label).toBe("WhatsApp desconectado desde 26 sep 18:27");
    expect(s?.lines[0].value).toBe("ya no está conectado en Zernio desde 26 sep 18:27");
  });

  it("gris: la última revisión tiene más de 15 min (aunque dijera rojo)", () => {
    const old = state({ level: "down", reasons: ["desconectado"], downSince: "2026-09-27T16:00:00Z", checkedAt: "2026-09-27T16:44:00Z" });
    expect(status([old])).toMatchObject({ tone: "gray", label: "Sin revisar desde 09:44" });
    // Justo en 15 min todavía cuenta como al día.
    expect(status([state({ checkedAt: "2026-09-27T16:45:00Z" })])?.tone).toBe("green");
  });

  it("gris sin hora: nunca revisado o Redis no respondió", () => {
    expect(status(null)).toMatchObject({ tone: "gray", label: "Sin revisar" });
    expect(status([])).toMatchObject({ tone: "gray", label: "Sin revisar" });
  });

  it("sin canales de WhatsApp activos no hay pastilla", () => {
    expect(status([state()], { channels: [] })).toBeNull();
  });

  it("dos números: el peor manda y cada uno tiene su línea", () => {
    const s = status([state(), state({ channelId: "ch_2", level: "down", reasons: ["desconectado"], downSince: "2026-09-27T16:40:00Z" })], {
      channels: [CHANNEL, { id: "ch_2", displayName: "Ventas 2" }],
    });
    expect(s?.tone).toBe("red");
    expect(s?.lines.slice(0, 2).map((l) => l.label)).toEqual(["Número Diluvium", "Número Ventas 2"]);
  });
});

describe("recuadro de 4 líneas", () => {
  it("número, último mensaje, worker y webhook", () => {
    expect(status([state()])?.lines).toEqual([
      { label: "Número", value: "conectado", tone: "green" },
      { label: "Último mensaje de un cliente", value: "hace 12 min", tone: "neutral" },
      { label: "Worker", value: "activo", tone: "green" },
      { label: "Webhook de Zernio", value: "activo · 0 fallos (09:50)", tone: "green" },
    ]);
  });

  it("worker sin latido reciente, webhook con fallos o sin revisar, sin mensajes", () => {
    const lines = status([state()], {
      lastInboundAt: null,
      workerHeartbeatAt: new Date("2026-09-27T16:50:00Z"),
      webhook: { checkedAt: "2026-09-27T16:50:00Z", webhook: { isActive: true, failureCount: 3 } },
    })?.lines;
    expect(lines?.slice(1)).toEqual([
      { label: "Último mensaje de un cliente", value: "ninguno todavía", tone: "neutral" },
      { label: "Worker", value: "inactivo desde 09:50", tone: "red" },
      { label: "Webhook de Zernio", value: "activo · 3 fallos (09:50)", tone: "amber" },
    ]);
    const none = status([state()], { workerHeartbeatAt: null, webhook: { checkedAt: "2026-09-27T16:50:00Z", webhook: null } })?.lines;
    expect(none?.[2]).toEqual({ label: "Worker", value: "inactivo (sin latido)", tone: "red" });
    expect(none?.[3]).toEqual({ label: "Webhook de Zernio", value: "no se pudo revisar (09:50)", tone: "amber" });
    const stale = status([state()], { webhook: { checkedAt: "2026-09-27T15:30:00Z", webhook: { isActive: false, failureCount: 1 } } })?.lines;
    expect(stale?.[3]).toEqual({ label: "Webhook de Zernio", value: "sin revisar desde 08:30", tone: "gray" });
  });
});
