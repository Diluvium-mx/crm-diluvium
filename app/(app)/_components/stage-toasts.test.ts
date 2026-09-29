import { describe, expect, it } from "vitest";
import type { ContactUpdatedEvent } from "@/lib/inbox/types";
import { defaultStages, stageLabel } from "@/lib/contacts/stages";
import {
  groupText,
  MAX_TOASTS,
  MOBILE_TOAST_MS,
  nextExpiry,
  pruneExpired,
  pushStageToast,
  renewToast,
  stageToastFor as stageToastForRaw,
  TOAST_MS,
  type StageToast,
} from "./stage-toasts";

const ME = "u_yo";
// El nombre de la etapa lo pone quien muestra el aviso (columnas editables); aquí, las 5 de siempre.
const labelOf = (key: string) => stageLabel(defaultStages(), key);
const stageToastFor = (event: ContactUpdatedEvent, viewer: string) => stageToastForRaw(event, viewer, labelOf);

function event(overrides: Partial<ContactUpdatedEvent> = {}): ContactUpdatedEvent {
  return {
    type: "contact.updated",
    contactId: "c1",
    contactName: "Juan Pérez",
    changes: ["etapa"],
    stage: { from: "prospecto", to: "interesado" },
    by: { kind: "agente" },
    at: "2026-09-26T16:00:00.000Z",
    ...overrides,
  };
}

describe("stageToastFor", () => {
  it("arma el texto del dueño según quién movió", () => {
    expect(stageToastFor(event(), ME)?.text).toBe("🤖 Agente IA movió a Juan Pérez a Interesado");
    expect(
      stageToastFor(event({ by: { kind: "automatizacion", userId: null }, stage: { from: "interesado", to: "cerca_compra" } }), ME)?.text,
    ).toBe("⚙️ Automatización movió a Juan Pérez a Cerca de compra");
    expect(
      stageToastFor(event({ by: { kind: "vendedor", userId: "u_daniel", name: "Daniel López" }, stage: { from: "cerca_compra", to: "compra" } }), ME)
        ?.text,
    ).toBe("Daniel movió a Juan Pérez a Compra");
  });

  it("en el celular el vendedor lleva 👨🏽‍💻; el Agente IA y la automatización, lo de siempre", () => {
    expect(stageToastFor(event(), ME)?.mobileText).toBe("🤖 Agente IA movió a Juan Pérez a Interesado");
    expect(stageToastFor(event({ by: { kind: "automatizacion", userId: null } }), ME)?.mobileText).toBe(
      "⚙️ Automatización movió a Juan Pérez a Interesado",
    );
    expect(stageToastFor(event({ by: { kind: "vendedor", userId: "u_daniel", name: "Daniel López" } }), ME)?.mobileText).toBe(
      "👨🏽‍💻 Daniel movió a Juan Pérez a Interesado",
    );
  });

  it("también avisa a quien hizo el cambio (a mano o por su /banco): todos ven el mismo aviso", () => {
    expect(stageToastFor(event({ by: { kind: "vendedor", userId: ME, name: "Luis Admin" } }), ME)?.mobileText).toBe(
      "👨🏽‍💻 Luis movió a Juan Pérez a Interesado",
    );
    expect(stageToastFor(event({ by: { kind: "automatizacion", userId: ME } }), ME)).not.toBeNull();
    expect(stageToastFor(event({ by: { kind: "automatizacion", userId: "u_otro" } }), ME)).not.toBeNull();
  });

  it("solo etapa: temperatura, cotización y Detalle van sin aviso", () => {
    for (const change of ["temperatura", "cotizacion", "detalle", "comentarios"] as const) {
      expect(stageToastFor(event({ changes: [change], stage: undefined }), ME)).toBeNull();
    }
  });

  it("nombres vacíos no rompen el texto", () => {
    expect(stageToastFor(event({ contactName: "  ", by: { kind: "vendedor", userId: "u2", name: "" } }), ME)?.text).toBe(
      "Un vendedor movió a un contacto a Interesado",
    );
  });
});

describe("pushStageToast", () => {
  const info = (contactId: string) => ({ contactId, text: `movió ${contactId}`, mobileText: `📱 movió ${contactId}` });

  it("apila hasta 3 y el cuarto los junta en uno", () => {
    let toasts: StageToast[] = [];
    for (let i = 1; i <= MAX_TOASTS; i++) toasts = pushStageToast(toasts, info(`c${i}`), 1_000 + i, `k${i}`);
    expect(toasts).toHaveLength(3);
    toasts = pushStageToast(toasts, info("c4"), 2_000, "k4");
    expect(toasts).toEqual([
      { kind: "group", key: "k4", contactIds: ["c1", "c2", "c3", "c4"], items: ["c1", "c2", "c3", "c4"].map(info), expiresAt: 2_000 + TOAST_MS },
    ]);
    // Los que siguen se suman al grupo (sin repetir contactos) y renuevan sus 10 s.
    toasts = pushStageToast(toasts, info("c5"), 3_000, "k5");
    toasts = pushStageToast(toasts, info("c1"), 4_000, "k6");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: "group", contactIds: ["c1", "c2", "c3", "c4", "c5"], expiresAt: 4_000 + TOAST_MS });
    expect(groupText(5)).toBe("5 contactos cambiaron de etapa");
  });

  it("el mismo contacto actualiza su aviso en vez de apilar otro", () => {
    let toasts = pushStageToast([], { contactId: "c1", text: "a Interesado", mobileText: "m Interesado" }, 1_000, "k1");
    toasts = pushStageToast(toasts, { contactId: "c1", text: "a Cerca de compra", mobileText: "m Cerca de compra" }, 2_000, "k2");
    expect(toasts).toEqual([
      { kind: "single", key: "k1", contactId: "c1", text: "a Cerca de compra", mobileText: "m Cerca de compra", expiresAt: 2_000 + TOAST_MS },
    ]);
  });

  it("los vencidos ya no cuentan para el tope", () => {
    let toasts: StageToast[] = [];
    for (let i = 1; i <= 3; i++) toasts = pushStageToast(toasts, info(`c${i}`), 0, `k${i}`);
    toasts = pushStageToast(toasts, info("c4"), TOAST_MS + 1, "k4");
    expect(toasts).toEqual([{ kind: "single", key: "k4", contactId: "c4", text: "movió c4", mobileText: "📱 movió c4", expiresAt: 2 * TOAST_MS + 1 }]);
    expect(nextExpiry(toasts)).toBe(2 * TOAST_MS + 1);
    expect(nextExpiry([])).toBeNull();
  });
});

describe("versión móvil", () => {
  const info = (contactId: string) => ({ contactId, text: `movió ${contactId}`, mobileText: `📱 movió ${contactId}` });

  it("dura 4 s en el celular", () => {
    const toasts = pushStageToast([], info("c1"), 1_000, "k1", MOBILE_TOAST_MS);
    expect(MOBILE_TOAST_MS).toBe(4_000);
    expect(toasts[0].expiresAt).toBe(1_000 + 4_000);
  });

  it("el agrupado guarda cada cambio (el último de cada contacto) para desplegarse", () => {
    let toasts: StageToast[] = [];
    for (let i = 1; i <= 4; i++) toasts = pushStageToast(toasts, info(`c${i}`), i, `k${i}`, MOBILE_TOAST_MS);
    toasts = pushStageToast(toasts, { contactId: "c2", text: "otra vez c2", mobileText: "📱 otra vez c2" }, 10, "k5", MOBILE_TOAST_MS);
    expect(toasts).toHaveLength(1);
    const group = toasts[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") return;
    expect(group.items.map((i) => i.mobileText)).toEqual(["📱 movió c1", "📱 movió c3", "📱 movió c4", "📱 otra vez c2"]);
    expect(group.contactIds).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("el agrupado desplegado no vence; al plegarlo vuelve a contar 4 s", () => {
    let toasts: StageToast[] = [];
    for (let i = 1; i <= 4; i++) toasts = pushStageToast(toasts, info(`c${i}`), 0, `k${i}`, MOBILE_TOAST_MS);
    const key = toasts[0].key;
    expect(pruneExpired(toasts, 60_000, key)).toHaveLength(1);
    expect(nextExpiry(toasts, key)).toBeNull();
    expect(pruneExpired(toasts, 60_000)).toHaveLength(0);
    // Un cambio nuevo mientras está desplegado se suma a él (no lo pierde por vencido).
    toasts = pushStageToast(toasts, info("c5"), 60_000, "k5", MOBILE_TOAST_MS, key);
    expect(toasts).toHaveLength(1);
    toasts = renewToast(toasts, key, 70_000, MOBILE_TOAST_MS);
    expect(nextExpiry(toasts)).toBe(74_000);
  });
});
