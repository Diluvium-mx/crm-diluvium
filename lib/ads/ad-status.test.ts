import { describe, expect, it } from "vitest";
import { adStatusOf, STATUS_STALE_MS } from "./ad-status";

const now = new Date("2026-09-25T20:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("estado del anuncio en la tabla", () => {
  it("ACTIVE = Activa; cualquier otro estado de Meta = Pausada", () => {
    expect(adStatusOf({ effectiveStatus: "ACTIVE", statusCheckedAt: ago(60_000) }, now)).toBe("active");
    for (const s of ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "DELETED", "PENDING_REVIEW", "DISAPPROVED"]) {
      expect(adStatusOf({ effectiveStatus: s, statusCheckedAt: ago(60_000) }, now), s).toBe("paused");
    }
  });

  it("sin lectura, o lectura más vieja que el margen (Meta falló) → desconocido ('—')", () => {
    expect(adStatusOf(null, now)).toBe("unknown");
    expect(adStatusOf({ effectiveStatus: null, statusCheckedAt: ago(0) }, now)).toBe("unknown");
    expect(adStatusOf({ effectiveStatus: "ACTIVE", statusCheckedAt: null }, now)).toBe("unknown");
    expect(adStatusOf({ effectiveStatus: "ACTIVE", statusCheckedAt: ago(STATUS_STALE_MS) }, now)).toBe("active");
    expect(adStatusOf({ effectiveStatus: "ACTIVE", statusCheckedAt: ago(STATUS_STALE_MS + 1) }, now)).toBe("unknown");
  });
});
