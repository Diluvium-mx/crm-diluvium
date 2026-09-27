import { describe, expect, it } from "vitest";
import type { ContactUpdatedEvent } from "@/lib/inbox/types";
import { defaultStages, stageLabel } from "@/lib/contacts/stages";
import { groupText, MAX_TOASTS, nextExpiry, pushStageToast, stageToastFor as stageToastForRaw, TOAST_MS, type StageToast } from "./stage-toasts";

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

  it("nunca avisa un cambio del mismo usuario (a mano o por su /banco)", () => {
    expect(stageToastFor(event({ by: { kind: "vendedor", userId: ME, name: "Yo" } }), ME)).toBeNull();
    expect(stageToastFor(event({ by: { kind: "automatizacion", userId: ME } }), ME)).toBeNull();
    // El /banco de OTRO vendedor sí.
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
  const info = (contactId: string) => ({ contactId, text: `movió ${contactId}` });

  it("apila hasta 3 y el cuarto los junta en uno", () => {
    let toasts: StageToast[] = [];
    for (let i = 1; i <= MAX_TOASTS; i++) toasts = pushStageToast(toasts, info(`c${i}`), 1_000 + i, `k${i}`);
    expect(toasts).toHaveLength(3);
    toasts = pushStageToast(toasts, info("c4"), 2_000, "k4");
    expect(toasts).toEqual([{ kind: "group", key: "k4", contactIds: ["c1", "c2", "c3", "c4"], expiresAt: 2_000 + TOAST_MS }]);
    // Los que siguen se suman al grupo (sin repetir contactos) y renuevan sus 10 s.
    toasts = pushStageToast(toasts, info("c5"), 3_000, "k5");
    toasts = pushStageToast(toasts, info("c1"), 4_000, "k6");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: "group", contactIds: ["c1", "c2", "c3", "c4", "c5"], expiresAt: 4_000 + TOAST_MS });
    expect(groupText(5)).toBe("5 contactos cambiaron de etapa");
  });

  it("el mismo contacto actualiza su aviso en vez de apilar otro", () => {
    let toasts = pushStageToast([], { contactId: "c1", text: "a Interesado" }, 1_000, "k1");
    toasts = pushStageToast(toasts, { contactId: "c1", text: "a Cerca de compra" }, 2_000, "k2");
    expect(toasts).toEqual([{ kind: "single", key: "k1", contactId: "c1", text: "a Cerca de compra", expiresAt: 2_000 + TOAST_MS }]);
  });

  it("los vencidos ya no cuentan para el tope", () => {
    let toasts: StageToast[] = [];
    for (let i = 1; i <= 3; i++) toasts = pushStageToast(toasts, info(`c${i}`), 0, `k${i}`);
    toasts = pushStageToast(toasts, info("c4"), TOAST_MS + 1, "k4");
    expect(toasts).toEqual([{ kind: "single", key: "k4", contactId: "c4", text: "movió c4", expiresAt: 2 * TOAST_MS + 1 }]);
    expect(nextExpiry(toasts)).toBe(2 * TOAST_MS + 1);
    expect(nextExpiry([])).toBeNull();
  });
});
