import { describe, expect, it } from "vitest";
import { displayPhone, flagEmoji, formatPhone, phoneMatchesSearch } from "./phone-format";

describe("presentación de teléfonos", () => {
  it("formato internacional legible con bandera", () => {
    expect(formatPhone("+526682426364")).toBe("+52 668 242 6364");
    expect(displayPhone("+526682426364")).toBe("🇲🇽 +52 668 242 6364");
    expect(flagEmoji("US")).toBe("🇺🇸");
    expect(displayPhone(null)).toBe("");
  });

  it("la búsqueda acepta 10 dígitos, con o sin +52, con separadores y el 521 heredado", () => {
    for (const term of ["6682426364", "526682426364", "+52 668 242 6364", "668-242-6364", "5216682426364"]) {
      expect(phoneMatchesSearch("+526682426364", term)).toBe(true);
    }
    expect(phoneMatchesSearch("+526682426364", "999")).toBe(false);
    expect(phoneMatchesSearch(null, "668")).toBe(false);
  });
});
