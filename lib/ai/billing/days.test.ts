import { describe, expect, it } from "vitest";
import { addDays, addToDay, dayStartIso, mergeDays, monthStartUtc, round8, utcDay } from "./days";

describe("días UTC de cobro", () => {
  it("normaliza fechas e inicios de día y mes en UTC", () => {
    const now = new Date("2026-10-01T00:30:00+07:00");
    expect(utcDay(now)).toBe("2026-09-30");
    expect(dayStartIso("2026-09-30")).toBe("2026-09-30T00:00:00Z");
    expect(monthStartUtc(now)).toBe("2026-09-01");
  });

  it("addDays cruza fines de mes y años", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("round8 elimina ruido después de ocho decimales", () => {
    expect(round8(0.1 + 0.2)).toBe(0.3);
    expect(round8(1.234567895)).toBe(1.2345679);
  });

  it("addToDay acumula todo y solamente el grupo indicado", () => {
    const days = { "2026-10-01": { todo: 1, prod: 0.75 } };
    addToDay(days, "2026-10-01", 0.2, "prod");
    addToDay(days, "2026-10-01", 0.3, "pruebas");
    addToDay(days, "2026-10-02", 0.123456789, "pruebas");

    expect(days).toEqual({
      "2026-10-01": { todo: 1.5, prod: 0.95, pruebas: 0.3 },
      "2026-10-02": { todo: 0.12345679, pruebas: 0.12345679 },
    });
  });

  it("mergeDays conserva lo anterior y sustituye por completo desde replaceFrom", () => {
    const stored = {
      "2026-09-29": { todo: 1 },
      "2026-09-30": { todo: 2 },
      "2026-10-01": { todo: 3 },
      "2026-10-02": { todo: 4 },
    };
    const fresh = {
      "2026-09-29": { todo: 99 },
      "2026-10-02": { todo: 40 },
      "2026-10-03": { todo: 5 },
    };

    expect(mergeDays(stored, fresh, "2026-10-01")).toEqual({
      "2026-09-29": { todo: 1 },
      "2026-09-30": { todo: 2 },
      // El 1-oct guardado desaparece porque la lectura nueva ya no lo trae.
      "2026-10-02": { todo: 40 },
      "2026-10-03": { todo: 5 },
    });
  });
});
