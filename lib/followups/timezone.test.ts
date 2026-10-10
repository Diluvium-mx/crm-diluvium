// Zona horaria del cliente según su lada (docs/seguimientos.md §9) y el saludo del texto.
import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_ZONE, zoneForPhone } from "./timezone";
import { followUpText, greetingFor } from "./message";

describe("zoneForPhone", () => {
  it.each([
    ["+526681234567", "America/Mazatlan"], // Los Mochis (Sinaloa)
    ["+526691234567", "America/Mazatlan"], // Mazatlán
    ["+5215512345678", "America/Mexico_City"], // CDMX con el 1 heredado de WhatsApp
    ["+523312345678", "America/Mexico_City"], // Guadalajara
    ["+526641234567", "America/Tijuana"], // Tijuana
    ["+526621234567", "America/Hermosillo"], // Hermosillo
    ["+526141234567", "America/Chihuahua"], // Chihuahua
    ["+526561234567", "America/Ciudad_Juarez"], // Ciudad Juárez
    ["+529981234567", "America/Cancun"], // Cancún
    ["+523291234567", "America/Mexico_City"], // Bahía de Banderas (Nayarit, hora del centro)
    ["+528991234567", "America/Matamoros"], // Reynosa (frontera: horario de verano como EE. UU.)
    ["+528681234567", "America/Matamoros"], // Matamoros
    ["+528671234567", "America/Matamoros"], // Nuevo Laredo
    ["+528781234567", "America/Matamoros"], // Piedras Negras
    ["+528771234567", "America/Matamoros"], // Ciudad Acuña
    ["+526261234567", "America/Ojinaga"], // Ojinaga
    ["+528181234567", "America/Mexico_City"], // Monterrey (no es frontera: sin horario de verano)
  ])("%s → %s", (phone, zone) => {
    expect(zoneForPhone(phone)).toBe(zone);
  });

  it("frontera noreste en octubre: una hora más que el centro (21:00 de Reynosa = 20:00 del centro); en diciembre, igual", () => {
    const hour = (zone: string, iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(new Date(iso));
    expect(hour(zoneForPhone("+528991234567"), "2026-10-10T02:00:00Z")).toBe("21");
    expect(hour(zoneForPhone("+523312345678"), "2026-10-10T02:00:00Z")).toBe("20");
    expect(hour(zoneForPhone("+528991234567"), "2026-12-10T03:00:00Z")).toBe("21");
    expect(hour(zoneForPhone("+523312345678"), "2026-12-10T03:00:00Z")).toBe("21");
  });

  it("otro país o sin teléfono: Mazatlán (la hora del CRM)", () => {
    expect(zoneForPhone("+12065550100")).toBe(DEFAULT_CLIENT_ZONE);
    expect(zoneForPhone(null)).toBe(DEFAULT_CLIENT_ZONE);
  });
});

describe("saludo que pone el CRM", () => {
  const zone = "America/Mexico_City";
  const t = (h: string) => new Date(`2026-10-05T${h}:00-06:00`);
  it("buenos días antes de las 12, buenas tardes hasta las 19, buenas noches después", () => {
    expect(greetingFor(t("11:59"), zone)).toBe("buenos días");
    expect(greetingFor(t("12:00"), zone)).toBe("buenas tardes");
    expect(greetingFor(t("19:00"), zone)).toBe("buenas noches");
  });
  it("con y sin nombre", () => {
    // Nunca el nombre del perfil (decisión del dueño, 6-oct-2026).
    expect(followUpText("¿Pudo medir el ancho?", t("20:00"), zone)).toBe("Hola, buenas noches, le escribo de parte del equipo de Diluvium. ¿Pudo medir el ancho?");
    expect(followUpText(" ¿Pudo medir el ancho? ", t("10:00"), zone)).toBe("Hola, buenos días, le escribo de parte del equipo de Diluvium. ¿Pudo medir el ancho?");
  });
});
