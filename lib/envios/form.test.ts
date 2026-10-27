// La ventana «Hacer guía» (docs/envios.md): qué llega lleno y qué se acepta.
import { describe, expect, it } from "vitest";
import type { SavedPackage } from "@/lib/envia/client";
import { createShipmentSchema, defaultPackages, destinationSchema, packageForEntrada, packagesWithValue, shipmentInputSchema, volumetricKg, FIXED_DECLARED_VALUE, FIXED_NOTE } from "./form";
import { preferredOptionIndex, reviewReason, serviceHint, serviceName, trackingMessage } from "./messages";

// Los embalajes guardados del dueño (26-oct-2026).
const SAVED: SavedPackage[] = [
  { id: "1", name: "Compuerta Anti-Inundaciones", content: null, lengthCm: 89, widthCm: 7, heightCm: 33, weightKg: 5 },
  { id: "2", name: "Compuerta Chica", content: null, lengthCm: 91, widthCm: 14, heightCm: 66, weightKg: 13 },
  { id: "3", name: "Compuerta Extra Chica", content: null, lengthCm: 70, widthCm: 13, heightCm: 65, weightKg: 14 },
  { id: "4", name: "Compuerta Extra Grande", content: null, lengthCm: 114, widthCm: 13, heightCm: 68, weightKg: 16 },
  { id: "5", name: "Compuerta Grande", content: null, lengthCm: 102, widthCm: 14, heightCm: 66, weightKg: 15.5 },
  { id: "6", name: "Compuerta Mediana", content: null, lengthCm: 95, widthCm: 14, heightCm: 66, weightKg: 15.5 },
  { id: "7", name: "Compuerta XXCH", content: null, lengthCm: 11, widthCm: 64, heightCm: 69, weightKg: 12 },
];

const DEST = {
  name: "María López",
  phone: "668 111 2233",
  email: "",
  street: "Av. Ejemplo",
  number: "123",
  district: "Centro",
  city: "Los Mochis",
  state: "si",
  stateName: "Sinaloa",
  postalCode: "81200",
  reference: "",
};

describe("embalaje por talla", () => {
  it("cada talla estándar toma su embalaje (el manual manda sobre el sugerido)", () => {
    expect(packageForEntrada({ linea: "estandar", tamanoSugerido: "CH", tamanoManual: null }, SAVED)?.name).toBe("Compuerta Chica");
    expect(packageForEntrada({ linea: "estandar", tamanoSugerido: "CH", tamanoManual: "xg" }, SAVED)?.name).toBe("Compuerta Extra Grande");
    expect(packageForEntrada({ linea: "estandar", tamanoSugerido: "XCH", tamanoManual: null }, SAVED)?.name).toBe("Compuerta Extra Chica");
  });

  it("mini, a la medida o sin talla: la elige el vendedor", () => {
    expect(packageForEntrada({ linea: "mini", tamanoSugerido: "CH", tamanoManual: null }, SAVED)).toBeNull();
    expect(packageForEntrada({ linea: "estandar", tamanoSugerido: "A la medida", tamanoManual: null }, SAVED)).toBeNull();
    expect(packageForEntrada({ linea: null, tamanoSugerido: null, tamanoManual: null }, SAVED)).toBeNull();
  });

  it("una caja por entrada; sin entradas, una caja vacía", () => {
    const two = defaultPackages(
      [
        { linea: "estandar", tamanoSugerido: "M", tamanoManual: null },
        { linea: "estandar", tamanoSugerido: "A la medida", tamanoManual: null },
      ],
      SAVED,
    );
    expect(two.map((p) => p.packageName)).toEqual(["Compuerta Mediana", null]);
    expect(two[0]).toMatchObject({ lengthCm: 95, widthCm: 14, heightCm: 66, weightKg: 15.5, content: "Compuerta Anti-Inundaciones" });
    expect(defaultPackages([], SAVED)).toEqual([expect.objectContaining({ packageId: null, lengthCm: 0 })]);
  });
});

describe("reglas fijas del dueño (27-oct-2026) y peso", () => {
  it("valor declarado $4,000 por guía y la nota «Compuerta Anti-Inundaciones»", () => {
    expect(FIXED_DECLARED_VALUE).toBe(4000);
    expect(FIXED_NOTE).toBe("Compuerta Anti-Inundaciones");
    expect(defaultPackages([{ linea: "estandar", tamanoSugerido: "CH", tamanoManual: null }], SAVED)[0]!.declaredValue).toBe(4000);
  });

  it("peso volumétrico ÷5,000 (Chica: 16.82 kg, como lo muestra Envia)", () => {
    expect(volumetricKg({ lengthCm: 91, widthCm: 14, heightCm: 66 })).toBe(16.82);
  });
});

describe("validación", () => {
  it("teléfono a 10 dígitos, estado en mayúsculas, correo vacío = sin correo", () => {
    const d = destinationSchema.parse(DEST);
    expect(d).toMatchObject({ phone: "6681112233", state: "SI", email: null, reference: "" });
  });

  it("mensajes claros para el vendedor", () => {
    expect(destinationSchema.safeParse({ ...DEST, phone: "668 111" }).error?.issues[0]?.message).toBe("El teléfono debe tener 10 dígitos.");
    expect(destinationSchema.safeParse({ ...DEST, postalCode: "812" }).error?.issues[0]?.message).toBe("El código postal debe tener 5 dígitos.");
    expect(destinationSchema.safeParse({ ...DEST, state: "" }).error?.issues[0]?.message).toBe("Falta el estado (escribe el código postal).");
    const sinMedidas = shipmentInputSchema.safeParse({
      contactId: "c1",
      destination: DEST,
      packages: [{ packageName: null, content: "Compuerta", lengthCm: 0, widthCm: 10, heightCm: 10, weightKg: 5 }],
    });
    expect(sinMedidas.error?.issues[0]?.message).toBe("Falta el largo.");
  });

  it("la guía necesita llave, paquetería y servicio", () => {
    const base = { contactId: "c1", destination: DEST, packages: [
        { packageName: "Compuerta Chica", content: "Compuerta", lengthCm: 91, widthCm: 14, heightCm: 66, weightKg: 13 },
        { packageName: "Compuerta Grande", content: "Compuerta", lengthCm: 102, widthCm: 14, heightCm: 66, weightKg: 15.5 },
      ] };
    expect(createShipmentSchema.safeParse({ ...base, requestKey: "no-es-uuid", carrier: "paquetexpress", service: "ground" }).success).toBe(false);
    const ok = createShipmentSchema.parse({ ...base, requestKey: crypto.randomUUID(), carrier: " Paquetexpress ", service: "ground" });
    expect(ok.carrier).toBe("paquetexpress");
    // Una guía por compuerta, cada una con su valor declarado fijo.
    expect(packagesWithValue(ok)).toEqual([
      expect.objectContaining({ packageName: "Compuerta Chica", declaredValue: 4000 }),
      expect.objectContaining({ packageName: "Compuerta Grande", declaredValue: 4000 }),
    ]);
  });
});

describe("mensaje con el rastreo", () => {
  it("de usted, con el número en negritas de WhatsApp y la liga si la hay", () => {
    expect(trackingMessage({ carrier: "paquetexpress", trackingNumber: "LMM01WE0191229", trackUrl: "https://envia.com/rastreo?label=LMM01WE0191229" })).toBe(
      "Le comparto su guía de Paquetexpress: *LMM01WE0191229*\nPuede rastrear su pedido aquí: https://envia.com/rastreo?label=LMM01WE0191229",
    );
    expect(trackingMessage({ carrier: "estafeta", trackingNumber: "123", trackUrl: null })).toBe("Le comparto su guía de Estafeta: *123*");
  });
});

describe("servicios de la cotización (como los da la cuenta real)", () => {
  it("nombre sin la paquetería repetida", () => {
    expect(serviceName("paquetexpress", "Paquetexpress Standard")).toBe("Standard");
    expect(serviceName("estafeta", "Estafeta Terrestre Ocurre - Domicilio")).toBe("Terrestre Ocurre - Domicilio");
    expect(serviceName("estafeta", "Terrestre")).toBe("Terrestre");
  });

  it("las variantes «Ocurre» se explican", () => {
    expect(serviceHint("ground")).toBe("a domicilio");
    expect(serviceHint("ground_od")).toBe("se deja en sucursal; llega a domicilio");
    expect(serviceHint("ground_do")).toBe("el cliente la recoge en sucursal");
  });

  const opt = (carrier: string, service: string, extendedFare = 0) => ({ carrier, service, extendedFare });

  it("viene marcada Paquetexpress puerta a puerta aunque cueste unos pesos más (Culiacán, 27-oct-2026)", () => {
    // De la más barata a la más cara, como las da Envia.
    const culiacan = [opt("estafeta", "ground_od"), opt("estafeta", "ground"), opt("paquetexpress", "ground_do"), opt("paquetexpress", "ground_od"), opt("paquetexpress", "ground")];
    expect(preferredOptionIndex(culiacan)).toBe(4);
    expect(reviewReason(culiacan)).toBeNull();
  });

  it("aviso al vendedor: zona extendida o Paquetexpress no llega (Veracruz 95850, 27-oct-2026)", () => {
    const veracruz = [opt("estafeta", "ground_od", 185), opt("estafeta", "ground", 185)];
    expect(preferredOptionIndex(veracruz)).toBe(1);
    expect(reviewReason(veracruz)).toBe("Paquetexpress no llega a este código postal: hay que elegir otra paquetería.");
    expect(reviewReason([opt("paquetexpress", "ground", 185)])).toBe("Es zona extendida: hay que elegir la paquetería.");
    expect(reviewReason([])).toBe("Ninguna paquetería dio precio para este destino.");
  });
});
