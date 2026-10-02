// Lectura de SYNOP de observatorios del SMN-Conagua con reportes reales de OGIMET (1 y 2-oct-2026).
import { describe, expect, it } from "vitest";
import {
  lluvia24hSynop,
  lluviaConfiable,
  reportesPorObservatorio,
  temperaturaSynop,
  type ReporteLluvia,
} from "@/lib/clima/synop";

const MONTERREY = "AAXX 02131 76393 22940 60701 10224 20212 39555 40117 86020 333 32/// 58045 69955 71725 91003==";
// Viento «10702» empieza con 1: no es la temperatura (esa es 10308 = 30.8 °C).
const VERACRUZ = "AAXX 02021 76692 22520 10702 10308 20272 30043 40056 52013 81100 333 30/// 70000==";

describe("lluvia24hSynop", () => {
  it("lee el grupo 7RRRR de la sección 333 en décimas de mm", () => {
    expect(lluvia24hSynop(MONTERREY)).toBe(172.5);
    expect(lluvia24hSynop(VERACRUZ)).toBe(0);
  });

  it("un 7xxxx de la sección nacional (555) no cuenta", () => {
    expect(lluvia24hSynop("AAXX 01181 76040 02/// /0601 10343 30098 60001 333 58023 60007 91003 555 70005==")).toBeNull();
  });

  it("sin sección 333, o con el grupo vacío (7////), devuelve null", () => {
    expect(lluvia24hSynop("AAXX 01181 76040 02/// /0601 10343 30098 60001==")).toBeNull();
    expect(lluvia24hSynop("AAXX 01181 76040 02/// /0601 10343 333 58023 7////==")).toBeNull();
  });

  it("79999 (inapreciable) es 0 mm", () => {
    expect(lluvia24hSynop("AAXX 01181 76040 02/// /0601 10343 333 58023 79999==")).toBe(0);
  });
});

describe("temperaturaSynop", () => {
  it("toma el grupo 1snTTT después del viento, aunque el viento empiece con 1", () => {
    expect(temperaturaSynop(VERACRUZ)).toBe(30.8);
    expect(temperaturaSynop(MONTERREY)).toBe(22.4);
  });

  it("lee grados bajo cero (11023 = -2.3)", () => {
    expect(temperaturaSynop("AAXX 02021 76000 22520 80702 11023 20272 333 70000==")).toBe(-2.3);
  });

  it("con viento de 99 nudos o más salta el grupo 00fff", () => {
    expect(temperaturaSynop("AAXX 02021 76000 22520 82799 00105 10250 20200 333 70000==")).toBe(25);
  });
});

describe("lluviaConfiable", () => {
  const r = (mm: number, hora: number): ReporteLluvia => ({ t: new Date(Date.UTC(2026, 9, 2, hora)), mm, temp: null });

  it("un salto raro sin lluvia en el aeropuerto espera confirmación (Río Verde 93.9 → 155.2)", () => {
    expect(lluviaConfiable([r(155.2, 12), r(93.9, 11)], false)?.mm).toBe(93.9);
  });

  it("el mismo salto con tormenta en el aeropuerto entra al momento (Monterrey 1 → 77)", () => {
    expect(lluviaConfiable([r(77, 4), r(1, 3)], true)?.mm).toBe(77);
  });

  it("una bajada siempre entra: la lluvia vieja sale de la ventana de 24 h (Chetumal 5.2 → 0)", () => {
    expect(lluviaConfiable([r(0, 15), r(5.2, 14)], false)?.mm).toBe(0);
  });

  it("con un solo reporte usa ese; sin reportes, null", () => {
    expect(lluviaConfiable([r(8.9, 15)], false)?.mm).toBe(8.9);
    expect(lluviaConfiable([], false)).toBeNull();
  });
});

describe("reportesPorObservatorio", () => {
  it("agrupa por observatorio, del más nuevo al más viejo, y salta los que no traen la lluvia de 24 h", () => {
    const texto = [
      "76393,2026,10,02,14,00,AAXX 02141 76393 22930 53001 10226 20211 39560 40125 85020 333 32/// 58047 60005 71725 91002==",
      "76692,2026,10,02,15,00,AAXX 02151 76692 22556 10501 10295 20257 30071 40084 52011 81800 333 31/// 58001 60007 70896 91002",
      "76393,2026,10,02,15,00,AAXX 02151 76393 22930 62601 10234 20219 39565 40132 86020 333 32/// 58050 60057 71725 91002",
      "76692,2026,10,02,14,00,AAXX 02141 76692 22906 03601 10268 20251 30066 40078 52007 333 31/// 58004 60005==",
      "",
    ].join("\n");
    const mapa = reportesPorObservatorio(texto);
    expect([...mapa.keys()].sort()).toEqual(["76393", "76692"]);
    expect(mapa.get("76393")?.map((x) => x.t.toISOString())).toEqual(["2026-10-02T15:00:00.000Z", "2026-10-02T14:00:00.000Z"]);
    expect(mapa.get("76393")?.[0]).toMatchObject({ mm: 172.5, temp: 23.4 });
    expect(mapa.get("76692")).toHaveLength(1);
    expect(mapa.get("76692")?.[0].mm).toBe(89.6);
  });
});
