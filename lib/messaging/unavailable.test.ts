import { describe, expect, it } from "vitest";
import { completedMetadata, isUnavailableNotice } from "./unavailable";

const NOTICE = { code: 131060, title: "This message is unavailable.", details: "This message is currently unavailable." };

describe('aviso "no disponible" de Meta', () => {
  it("lo reconoce solo por metadata.unsupported", () => {
    expect(isUnavailableNotice({ unsupported: NOTICE })).toBe(true);
    expect(isUnavailableNotice({ referral: { source_id: "1" } })).toBe(false);
    expect(isUnavailableNotice({ unsupported: null })).toBe(false);
    expect(isUnavailableNotice(null)).toBe(false);
    expect(isUnavailableNotice(undefined)).toBe(false);
  });

  it("al completarse conserva lo previo, suma lo nuevo y deja de ser aviso", () => {
    const at = new Date("2026-09-27T01:37:26Z");
    const merged = completedMetadata(
      { unsupported: NOTICE, anuncioRespaldo: { resultado: "atribuido" } },
      { referral: { source_id: "120250108412590604" } },
      at,
    );
    expect(isUnavailableNotice(merged)).toBe(false);
    expect(merged).toEqual({
      anuncioRespaldo: { resultado: "atribuido" },
      referral: { source_id: "120250108412590604" },
      noDisponibleAntes: { ...NOTICE, completadoEn: "2026-09-27T01:37:26.000Z" },
    });
  });
});
