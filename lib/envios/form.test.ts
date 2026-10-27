// La ventana «Hacer guía» (docs/envios.md): qué llega lleno y qué se acepta.
import { describe, expect, it } from "vitest";
import type { SavedPackage } from "@/lib/envia/client";
import { createShipmentSchema, defaultPackages, destinationSchema, packageForEntrada, packagesWithValue, shipmentInputSchema, splitDeclaredValue, volumetricKg } from "./form";
import { defaultOptionIndex, serviceHint, serviceName, trackingMessage } from "./messages";

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

describe("valor declarado y peso", () => {
  it("se reparte entre las cajas y suma exacto", () => {
    expect(splitDeclaredValue(5500, 1)).toEqual([5500]);
    expect(splitDeclaredValue(1000, 3)).toEqual([333.33, 333.33, 333.34]);
    expect(splitDeclaredValue(10, 0)).toEqual([]);
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
      declaredValue: 0,
      insured: false,
    });
    expect(sinMedidas.error?.issues[0]?.message).toBe("Falta el largo.");
  });

  it("la guía necesita llave, paquetería y servicio", () => {
    const base = { contactId: "c1", destination: DEST, packages: [{ packageName: "Compuerta Chica", content: "Compuerta", lengthCm: 91, widthCm: 14, heightCm: 66, weightKg: 13 }], declaredValue: 5500, insured: true };
    expect(createShipmentSchema.safeParse({ ...base, requestKey: "no-es-uuid", carrier: "paquetexpress", service: "ground" }).success).toBe(false);
    const ok = createShipmentSchema.parse({ ...base, requestKey: crypto.randomUUID(), carrier: " Paquetexpress ", service: "ground" });
    expect(ok.carrier).toBe("paquetexpress");
    expect(packagesWithValue(ok)).toEqual([expect.objectContaining({ packageName: "Compuerta Chica", declaredValue: 5500 })]);
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

  it("las variantes «Ocurre» se explican y la marcada es la más barata a domicilio", () => {
    expect(serviceHint("ground")).toBe("a domicilio");
    expect(serviceHint("ground_od")).toBe("se deja en sucursal; llega a domicilio");
    expect(serviceHint("ground_do")).toBe("el cliente la recoge en sucursal");
    // Culiacán, Compuerta Chica (27-oct-2026), de la más barata a la más cara.
    expect(defaultOptionIndex([{ service: "ground_od" }, { service: "ground" }, { service: "ground_od" }, { service: "ground_do" }])).toBe(1);
    expect(defaultOptionIndex([{ service: "ground_do" }])).toBe(0);
  });
});
