import { describe, expect, it } from "vitest";
import { BOT_OPTIONS_DEFAULTS, botOptionsPatchSchema, type BotOptions } from "./opciones";
import { describePatch, draftFromOptions, draftToPatch, type OptionsDraft } from "./opciones-draft";

const saved: BotOptions = { ...BOT_OPTIONS_DEFAULTS };
const draft = (changes: Partial<OptionsDraft> = {}, from: BotOptions = saved): OptionsDraft => ({ ...draftFromOptions(from), ...changes });

describe("borrador de las Opciones → lo que se guarda", () => {
  it("sin tocar nada: nada que guardar y sin botones", () => {
    expect(draftToPatch(saved, draft())).toEqual({ patch: {}, errors: [], dirty: false });
    const custom: BotOptions = {
      ...saved,
      humanReplyReactivateHours: 12,
      handoverPauseHours: 8,
      schedule: { days: [5, 1, 1], from: "08:00", to: "18:00" },
      maxRepliesPerContact: 50,
    };
    expect(draftToPatch(custom, draftFromOptions(custom))).toEqual({ patch: {}, errors: [], dirty: false });
  });

  it("solo manda lo que cambió, y el servidor lo acepta en una sola llamada", () => {
    const r = draftToPatch(saved, draft({ responseDelaySeconds: 30, readImages: false, maxBubbles: 1 }));
    expect(r).toEqual({ patch: { responseDelaySeconds: 30, readImages: false, maxBubbles: 1 }, errors: [], dirty: true });
    expect(botOptionsPatchSchema.parse(r.patch)).toEqual(r.patch);
  });

  it("cambiar y regresar al valor guardado = sin cambios", () => {
    expect(draftToPatch(saved, draft({ responseDelaySeconds: 15 })).dirty).toBe(false);
  });

  it("horas de reactivar: 8 h / 24 h / número; «Nunca» = null", () => {
    expect(draftToPatch(saved, draft({ reactivateMode: "24" })).patch).toEqual({ humanReplyReactivateHours: 24 });
    expect(draftToPatch(saved, draft({ reactivateMode: "otro", reactivateHours: " 36 " })).patch).toEqual({ humanReplyReactivateHours: 36 });
    const withHours = { ...saved, humanReplyReactivateHours: 8 };
    expect(draftToPatch(withHours, draft({ reactivateMode: "nunca" }, withHours)).patch).toEqual({ humanReplyReactivateHours: null });
  });

  it("lo oculto no cuenta: con «Pausar el bot» = No, las horas de reactivar no se mandan ni se validan", () => {
    const r = draftToPatch(saved, draft({ pauseOnHumanReply: false, reactivateMode: "otro", reactivateHours: "abc" }));
    expect(r).toEqual({ patch: { pauseOnHumanReply: false }, errors: [], dirty: true });
  });

  it("pedir asesor, horario y tope con sus valores de arranque", () => {
    const r = draftToPatch(saved, draft({ handoverMode: "pausar", scheduleMode: "horario", maxRepliesMode: "tope" }));
    expect(r.patch).toEqual({
      handoverPauseHours: 8,
      schedule: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "18:00" },
      maxRepliesPerContact: 50,
    });
    expect(r.errors).toEqual([]);
  });

  it("inválido: se queda el botón (dirty) pero deshabilitado, y dice por qué", () => {
    const hours = draftToPatch(saved, draft({ reactivateMode: "otro", reactivateHours: "0" }));
    expect(hours.dirty).toBe(true);
    expect(hours.errors).toEqual(["Reactivar solo después de: escribe un número entero de horas entre 1 y 720."]);
    expect(draftToPatch(saved, draft({ handoverMode: "pausar", handoverHours: "721" })).errors[0]).toMatch(/^Cuando el cliente pide un asesor: /);
    expect(draftToPatch(saved, draft({ maxRepliesMode: "tope", maxReplies: "2.5" })).errors[0]).toMatch(/entre 1 y 1,000/);

    const noDays = draftToPatch(saved, draft({ scheduleMode: "horario", schedule: { days: [], from: "08:00", to: "18:00" } }));
    expect(noDays.errors).toEqual(["Horario del bot: elige al menos un día."]);
    const sameHour = draftToPatch(saved, draft({ scheduleMode: "horario", schedule: { days: [1], from: "09:00", to: "09:00" } }));
    expect(sameHour.errors).toEqual(["Horario del bot: la hora de inicio y la de fin no pueden ser iguales."]);
    const empty = draftToPatch(saved, draft({ scheduleMode: "horario", schedule: { days: [1], from: "", to: "18:00" } }));
    expect(empty.errors).toEqual(["Horario del bot: escribe la hora de inicio y la de fin."]);
  });

  it("los días del horario se comparan ordenados (el orden en que se tocaron no es un cambio)", () => {
    const withSchedule: BotOptions = { ...saved, schedule: { days: [1, 3, 5], from: "08:00", to: "18:00" } };
    expect(draftToPatch(withSchedule, draft({ schedule: { days: [5, 1, 3], from: "08:00", to: "18:00" } }, withSchedule)).dirty).toBe(false);
  });
});

describe("lista de cambios del pop-up", () => {
  it("una línea por campo, en el orden de la pantalla, con el valor anterior y el nuevo", () => {
    const { patch } = draftToPatch(saved, draft({ maxRepliesMode: "tope", maxReplies: "40", responseDelaySeconds: 30, scheduleMode: "horario" }));
    expect(describePatch(saved, patch)).toEqual([
      "Tiempo de espera antes de responder: 15 s → 30 s",
      "Horario del bot: 24/7 → lun–sáb 8:00–18:00 (hora de Mazatlán)",
      "Máximo de respuestas del bot por conversación: Sin tope → 40",
    ]);
  });

  it("sí/no y «Nunca»", () => {
    const { patch } = draftToPatch(saved, draft({ pauseOnHumanReply: false, transcribeAudio: false }));
    expect(describePatch(saved, patch)).toEqual(["Pausar el bot cuando un vendedor contesta: Sí → No", "Responder notas de voz: Sí → No"]);
    const withHours = { ...saved, humanReplyReactivateHours: 24 };
    expect(describePatch(withHours, { humanReplyReactivateHours: null })).toEqual(["Reactivar solo después de: 24 h → Nunca (a mano con «Activar»)"]);
  });
});
