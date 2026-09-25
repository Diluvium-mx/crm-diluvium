import { describe, expect, it } from "vitest";
import { formatLadaPlace, mexicanLada, phoneLocation, phoneLocationHint } from "./phone-lada";
import { LADA_CITIES } from "./phone-lada-cities";

const label = (e164: string | null) => phoneLocation(e164)?.label ?? null;

describe("phoneLocation (México, por lada)", () => {
  it("ladas de 2 dígitos con ciudad", () => {
    expect(label("+525512345678")).toBe("Ciudad de México");
    expect(label("+523312345678")).toBe("Guadalajara, Jal.");
    expect(label("+528112345678")).toBe("Monterrey, N.L.");
  });

  it("ladas de 3 dígitos con ciudad y estado abreviado", () => {
    expect(label("+522291234567")).toBe("Veracruz, Ver.");
    expect(label("+526651234567")).toBe("Tecate, B.C.");
    expect(label("+526601234567")).toBe("Culiacán");
  });

  // Google (libphonenumber v9.0.9) solo trae el ESTADO para 667/668/669/687
  // ("Sinaloa") y nada para 664: la ciudad sale de lib/phone-lada-cities.ts (dos
  // listas públicas que coinciden) y el estado, de Google.
  it("Sinaloa: la ciudad de las listas con el estado de Google", () => {
    expect(label("+526682426364")).toBe("Los Mochis, Sin.");
    expect(label("+526672426364")).toBe("Culiacán, Sin.");
    expect(label("+526692426364")).toBe("Mazatlán, Sin.");
    expect(label("+526872426364")).toBe("Guasave, Sin.");
  });

  it("Google no trae la lada: solo la ciudad (sin estado inventado)", () => {
    expect(label("+526641234567")).toBe("Tijuana");
  });

  it("Google da dos estados: solo la ciudad", () => {
    expect(label("+528671234567")).toBe("Nuevo Laredo");
  });

  it("donde Google ya trae ciudad, manda Google", () => {
    expect(label("+526651234567")).toBe("Tecate, B.C.");
    expect(label("+529991234567")).toBe("Conkal/Mérida, Yuc.");
  });

  it("891: las listas dicen Santa Rosalía (B.C.S.), Google dice Tamaulipas → Tamaulipas", () => {
    expect(label("+528911234567")).toBe("Tamaulipas");
  });

  it("cada ciudad de las listas llena un hueco de Google (ninguna queda tapada)", () => {
    for (const [lada, city] of Object.entries(LADA_CITIES)) {
      const national = lada.padEnd(10, "0");
      expect(phoneLocation(`+52${national}`)?.label.startsWith(city), lada).toBe(true);
    }
    expect(Object.keys(LADA_CITIES)).toHaveLength(84);
  });

  it("el código ambiguo QRO de la fuente: Querétaro vs. Quintana Roo (Cozumel)", () => {
    expect(label("+524141234567")).toBe("Tequisquiapan, Qro.");
    expect(label("+529871234567")).toBe("Cozumel, Q. Roo");
  });

  it("el +521 heredado de WhatsApp cuenta igual", () => {
    expect(label("+5213312345678")).toBe("Guadalajara, Jal.");
  });

  it("lada del aviso: 2 dígitos para 55/56/33/81, 3 para el resto", () => {
    expect(phoneLocation("+526682426364")?.code).toBe("668");
    expect(phoneLocation("+523312345678")?.code).toBe("33");
    expect(mexicanLada("5612345678")).toBe("56");
    expect(phoneLocationHint(phoneLocation("+526682426364")!)).toBe("Según la lada 668 (dónde se contrató la línea)");
  });

  // 56 (la segunda lada de CDMX) no viene en los datos de Google: sin dato, nada.
  it("lada sin dato en la fuente o número incompleto: nada", () => {
    expect(label("+525612345678")).toBeNull();
    expect(label("+52668242")).toBeNull();
  });
});

describe("phoneLocation (otros países y vacíos)", () => {
  it("otro país: su nombre en español", () => {
    expect(label("+13105551234")).toBe("Estados Unidos");
    expect(label("+14165551234")).toBe("Canadá");
    expect(label("+34911234567")).toBe("España");
    expect(phoneLocation("+13105551234")?.code).toBe("+1");
  });

  it("sin teléfono: nada", () => {
    expect(phoneLocation(null)).toBeNull();
    expect(phoneLocation(undefined)).toBeNull();
    expect(phoneLocation("")).toBeNull();
  });
});

describe("formatLadaPlace", () => {
  it("abrevia el estado y deja tal cual lo que no tiene estado", () => {
    expect(formatLadaPlace("Altotonga/Jalacingo, VER")).toBe("Altotonga/Jalacingo, Ver.");
    expect(formatLadaPlace("Ciudad de México, CDMX")).toBe("Ciudad de México");
    expect(formatLadaPlace("Estado de México")).toBe("Estado de México");
    expect(formatLadaPlace("Lugar, XYZ")).toBe("Lugar, XYZ");
  });
});
