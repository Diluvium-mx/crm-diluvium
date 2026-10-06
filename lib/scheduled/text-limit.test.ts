import { describe, expect, it } from "vitest";
import { canScheduleText, clampLocal, localToInstant, textAllowedAt, textDeadline, textMaxLocal } from "./rules";
import { deadlineLong, deadlineShort } from "./deadline-format";

// 7-oct-2026 15:21:30 en Mazatlán (UTC-7).
const closes = new Date("2026-10-07T22:21:30Z");

describe("límite del texto programado", () => {
  it("WhatsApp: el máximo es el último minuto antes del cierre de la ventana", () => {
    expect(textMaxLocal(closes)).toBe("2026-10-07T15:21");
    // Ese minuto todavía cae dentro de la ventana; el siguiente ya no.
    expect(textAllowedAt(closes, localToInstant("2026-10-07T15:21")!)).toBe(true);
    expect(textAllowedAt(closes, localToInstant("2026-10-07T15:22")!)).toBe(false);
  });

  it("si la ventana cierra en punto, el máximo es el minuto anterior", () => {
    const exact = new Date("2026-10-07T22:21:00Z");
    expect(textMaxLocal(exact)).toBe("2026-10-07T15:20");
    expect(textAllowedAt(exact, localToInstant(textMaxLocal(exact)!)!)).toBe(true);
  });

  it("Instagram: 7 días desde el último mensaje del cliente (cierre de 24 h + 6 días)", () => {
    expect(textDeadline(closes, "instagram")?.toISOString()).toBe("2026-10-13T22:21:30.000Z");
    expect(textMaxLocal(closes, "instagram")).toBe("2026-10-13T15:21");
  });

  it("sin ventana no hay máximo", () => {
    expect(textMaxLocal(null)).toBeNull();
    expect(canScheduleText(null)).toBe(false);
  });

  it("texto deshabilitado si la ventana ya cerró o cierra en menos de 2 min", () => {
    expect(canScheduleText(closes, "whatsapp", new Date("2026-10-07T22:19:30Z"))).toBe(true);
    expect(canScheduleText(closes, "whatsapp", new Date("2026-10-07T22:19:31Z"))).toBe(false);
    expect(canScheduleText(closes, "whatsapp", new Date("2026-10-08T00:00:00Z"))).toBe(false);
    // Instagram sigue con texto pasado el cierre de 24 h.
    expect(canScheduleText(closes, "instagram", new Date("2026-10-08T00:00:00Z"))).toBe(true);
  });

  it("acota la hora entre el mínimo y el máximo", () => {
    expect(clampLocal("2026-10-07T16:30", "2026-10-07T14:00", "2026-10-07T15:21")).toBe("2026-10-07T15:21");
    expect(clampLocal("2026-10-07T13:00", "2026-10-07T14:00", "2026-10-07T15:21")).toBe("2026-10-07T14:00");
    expect(clampLocal("2026-10-07T14:30", "2026-10-07T14:00", "2026-10-07T15:21")).toBe("2026-10-07T14:30");
    expect(clampLocal("2026-10-09T10:00", "2026-10-07T14:00", null)).toBe("2026-10-09T10:00");
    // Nunca baja del mínimo aunque el máximo quede antes.
    expect(clampLocal("2026-10-07T16:30", "2026-10-07T15:30", "2026-10-07T15:21")).toBe("2026-10-07T15:30");
  });
});

describe("formato del límite (Mazatlán)", () => {
  const deadline = localToInstant("2026-10-07T15:21")!;
  it("largo: «mié 7 oct, 3:21 p.m.»", () => {
    expect(deadlineLong(deadline)).toBe("mié 7 oct, 3:21 p.m.");
  });
  it("corto: solo la hora si es hoy, el día si es esta semana, la fecha si es más lejos", () => {
    expect(deadlineShort(deadline, localToInstant("2026-10-07T09:00")!)).toBe("3:21 p.m.");
    expect(deadlineShort(deadline, localToInstant("2026-10-06T20:00")!)).toBe("mié 3:21 p.m.");
    expect(deadlineShort(localToInstant("2026-10-13T15:21")!, localToInstant("2026-10-06T20:00")!)).toBe("13 oct 3:21 p.m.");
  });
});
