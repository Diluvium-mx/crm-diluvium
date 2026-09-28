import { describe, expect, it } from "vitest";
import { localToInstant } from "@/lib/scheduled/rules";
import { roleAllows } from "@/lib/auth/permissions";
import { MAX_BUBBLES, RESPONSE_DELAY_SECONDS } from "@/lib/ai/runtime/policy";
import {
  BOT_OPTIONS_DEFAULTS,
  botOptionsPatchSchema,
  describeChange,
  describeSchedule,
  formatOptionValue,
  handoverPauseUntil,
  humanPauseUntil,
  isWithinSchedule,
} from "./opciones";

// Hora de Mazatlán → instante (para no depender del reloj de la máquina).
const mz = (local: string) => localToInstant(local)!;

describe("Opciones del bot: valores de fábrica = comportamiento de hoy", () => {
  it("coinciden con las constantes fijas del runtime (15 s, 2 mensajes) y con 'nada configurado'", () => {
    expect(BOT_OPTIONS_DEFAULTS).toEqual({
      responseDelaySeconds: RESPONSE_DELAY_SECONDS,
      pauseOnHumanReply: true,
      humanReplyReactivateHours: null,
      handoverPauseHours: null,
      schedule: null,
      readImages: true,
      transcribeAudio: true,
      responseLength: "balanceada",
      maxBubbles: MAX_BUBBLES,
      maxRepliesPerContact: null,
    });
    const now = new Date();
    expect(humanPauseUntil(BOT_OPTIONS_DEFAULTS, now)).toEqual({ pause: true, until: null }); // hasta "Activar"
    expect(handoverPauseUntil(BOT_OPTIONS_DEFAULTS, now)).toBeNull(); // avisar y seguir
    expect(isWithinSchedule(BOT_OPTIONS_DEFAULTS.schedule, now)).toBe(true); // 24/7
  });
});

describe("botOptionsPatchSchema", () => {
  it("acepta un cambio a la vez y rechaza valores fuera de rango", () => {
    expect(botOptionsPatchSchema.parse({ responseDelaySeconds: 5 })).toEqual({ responseDelaySeconds: 5 });
    expect(botOptionsPatchSchema.safeParse({ responseDelaySeconds: 4 }).success).toBe(false);
    expect(botOptionsPatchSchema.safeParse({ responseDelaySeconds: 61 }).success).toBe(false);
    expect(botOptionsPatchSchema.safeParse({ responseDelaySeconds: 7.5 }).success).toBe(false);
    expect(botOptionsPatchSchema.safeParse({ maxBubbles: 3 }).success).toBe(false);
    expect(botOptionsPatchSchema.safeParse({ maxRepliesPerContact: 0 }).success).toBe(false);
    expect(botOptionsPatchSchema.parse({ maxRepliesPerContact: null })).toEqual({ maxRepliesPerContact: null });
    expect(botOptionsPatchSchema.safeParse({ humanReplyReactivateHours: 721 }).success).toBe(false);
    expect(botOptionsPatchSchema.safeParse({ responseLength: "larga" }).success).toBe(false);
    expect(botOptionsPatchSchema.safeParse({}).success).toBe(false);
    // Una llave con undefined (React Flight la conserva) no cuenta como cambio.
    expect(botOptionsPatchSchema.safeParse({ responseDelaySeconds: undefined }).success).toBe(false);
    expect(botOptionsPatchSchema.parse({ responseDelaySeconds: undefined, maxBubbles: 1 })).toEqual({ maxBubbles: 1 });
    expect(botOptionsPatchSchema.safeParse({ otra: 1 }).success).toBe(false);
  });

  it("horario: días únicos y ordenados, horas HH:MM, inicio ≠ fin", () => {
    expect(botOptionsPatchSchema.parse({ schedule: { days: [5, 1, 1], from: "08:00", to: "18:00" } })).toEqual({ schedule: { days: [1, 5], from: "08:00", to: "18:00" } });
    expect(botOptionsPatchSchema.safeParse({ schedule: { days: [], from: "08:00", to: "18:00" } }).success).toBe(false);
    expect(botOptionsPatchSchema.safeParse({ schedule: { days: [8], from: "08:00", to: "18:00" } }).success).toBe(false);
    expect(botOptionsPatchSchema.safeParse({ schedule: { days: [1], from: "8:00", to: "18:00" } }).success).toBe(false);
    expect(botOptionsPatchSchema.safeParse({ schedule: { days: [1], from: "09:00", to: "09:00" } }).success).toBe(false);
    expect(botOptionsPatchSchema.parse({ schedule: null })).toEqual({ schedule: null });
  });
});

describe("isWithinSchedule (hora de Mazatlán)", () => {
  const laboral = { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" }; // lun–vie
  it("dentro y fuera del horario, por día y por hora", () => {
    expect(isWithinSchedule(laboral, mz("2026-09-30T10:00"))).toBe(true); // miércoles 10:00
    expect(isWithinSchedule(laboral, mz("2026-09-30T08:00"))).toBe(true); // justo al abrir
    expect(isWithinSchedule(laboral, mz("2026-09-30T18:00"))).toBe(false); // justo al cerrar
    expect(isWithinSchedule(laboral, mz("2026-09-30T07:59"))).toBe(false);
    expect(isWithinSchedule(laboral, mz("2026-10-03T10:00"))).toBe(false); // sábado
    expect(isWithinSchedule(laboral, mz("2026-10-04T10:00"))).toBe(false); // domingo
  });
  it("horario que cruza la medianoche cuenta para el día en que empezó", () => {
    const noche = { days: [5], from: "20:00", to: "02:00" }; // viernes en la noche
    expect(isWithinSchedule(noche, mz("2026-10-02T21:00"))).toBe(true); // viernes 21:00
    expect(isWithinSchedule(noche, mz("2026-10-03T01:00"))).toBe(true); // sábado 01:00 (sigue el viernes)
    expect(isWithinSchedule(noche, mz("2026-10-03T03:00"))).toBe(false);
    expect(isWithinSchedule(noche, mz("2026-10-02T19:00"))).toBe(false);
    expect(isWithinSchedule(noche, mz("2026-10-04T01:00"))).toBe(false); // domingo 01:00 (el sábado no está)
  });
  it("la hora es la de Mazatlán, no la UTC", () => {
    // 2026-09-30T17:30 Mazatlán = 00:30Z del 1-oct: en UTC ya sería "otro día y cerrado".
    expect(isWithinSchedule(laboral, mz("2026-09-30T17:30"))).toBe(true);
  });
});

describe("pausas según las opciones", () => {
  const now = mz("2026-09-30T10:00");
  it("un vendedor contesta: no pausar, hasta 'Activar' o N horas", () => {
    expect(humanPauseUntil({ pauseOnHumanReply: false, humanReplyReactivateHours: 8 }, now)).toEqual({ pause: false });
    expect(humanPauseUntil({ pauseOnHumanReply: true, humanReplyReactivateHours: null }, now)).toEqual({ pause: true, until: null });
    expect(humanPauseUntil({ pauseOnHumanReply: true, humanReplyReactivateHours: 8 }, now)).toEqual({ pause: true, until: new Date(now.getTime() + 8 * 3_600_000) });
  });
  it("pedir asesor: avisar y seguir, o avisar y pausar X horas", () => {
    expect(handoverPauseUntil({ handoverPauseHours: null }, now)).toBeNull();
    expect(handoverPauseUntil({ handoverPauseHours: 1 }, now)).toEqual(new Date(now.getTime() + 3_600_000));
  });
});

describe("textos", () => {
  it("describe el horario y cada valor en palabras", () => {
    expect(describeSchedule(null)).toBe("24/7");
    expect(describeSchedule({ days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" })).toBe("lun–vie 8:00–18:00 (hora de Mazatlán)");
    expect(describeSchedule({ days: [1, 3, 5], from: "09:00", to: "14:30" })).toBe("lun, mié y vie 9:00–14:30 (hora de Mazatlán)");
    expect(describeSchedule({ days: [1, 2, 3, 4, 5, 6, 7], from: "08:00", to: "20:00" })).toBe("todos los días 8:00–20:00 (hora de Mazatlán)");
    expect(formatOptionValue("responseDelaySeconds", 5)).toBe("5 s");
    expect(formatOptionValue("humanReplyReactivateHours", null)).toBe("Nunca (a mano con «Activar»)");
    expect(formatOptionValue("handoverPauseHours", 8)).toBe("Avisar y pausar al Agente IA 8 h");
    expect(formatOptionValue("maxRepliesPerContact", null)).toBe("Sin tope");
    expect(formatOptionValue("readImages", false)).toBe("No");
    expect(formatOptionValue("responseLength", "corta")).toBe("Corta");
  });
  it("'Último cambio: Daniel, hoy 11:20 · …'", () => {
    const now = mz("2026-09-30T12:00");
    const text = describeChange({ field: "responseDelaySeconds", oldValue: "15 s", newValue: "5 s", author: "Daniel", createdAt: mz("2026-09-30T11:20") }, now);
    expect(text).toBe("Daniel, hoy 11:20 · Tiempo de espera antes de responder: 15 s → 5 s");
  });
});

describe("permisos por rol", () => {
  it("vendedor, admin y owner editan las opciones (recurso aiConfig); un rol desconocido no", () => {
    for (const role of ["owner", "admin", "agent"]) {
      expect(roleAllows(role, "aiConfig", "read")).toBe(true);
      expect(roleAllows(role, "aiConfig", "update")).toBe(true);
    }
    expect(roleAllows("invitado", "aiConfig", "update")).toBe(false);
  });
});
