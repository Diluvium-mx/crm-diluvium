// La ventana «Hacer guía» (docs/envios.md): lo que llega ya lleno y la validación de lo que se manda.
// Puro (sin base ni red): lo usan las acciones y las pruebas.
import { z } from "zod";
import type { SavedPackage } from "@/lib/envia/client";
import { normalizeSearch } from "@/lib/text/search";
import type { ShipmentDestination, ShipmentPackage } from "@/lib/db/schema/shipments";

export const DEFAULT_CONTENT = "Compuerta Anti-Inundaciones";

// Talla estándar del Detalle (lib/contacts/sizes.ts) → nombre del embalaje guardado en Envia (los del dueño,
// 26-oct-2026). Las mini, «A la medida» y las demás las elige el vendedor en el menú.
const ESTANDAR_A_EMBALAJE: Readonly<Record<string, string>> = {
  XCH: "Compuerta Extra Chica",
  CH: "Compuerta Chica",
  M: "Compuerta Mediana",
  G: "Compuerta Grande",
  XG: "Compuerta Extra Grande",
};

export type EntradaTalla = { linea: string | null; tamanoSugerido: string | null; tamanoManual: string | null };

export function packageForEntrada(entrada: EntradaTalla, saved: readonly SavedPackage[]): SavedPackage | null {
  const talla = (entrada.tamanoManual ?? entrada.tamanoSugerido)?.trim().toUpperCase();
  if (!talla || entrada.linea === "mini") return null;
  const wanted = ESTANDAR_A_EMBALAJE[talla];
  if (!wanted) return null;
  return saved.find((p) => normalizeSearch(p.name) === normalizeSearch(wanted)) ?? null;
}

export type PackageDraft = ShipmentPackage & { packageId: string | null };

export function draftFromSaved(p: SavedPackage): PackageDraft {
  return {
    packageId: p.id,
    packageName: p.name,
    content: p.content ?? DEFAULT_CONTENT,
    lengthCm: p.lengthCm,
    widthCm: p.widthCm,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    declaredValue: 0,
  };
}

export const EMPTY_PACKAGE: PackageDraft = {
  packageId: null,
  packageName: null,
  content: DEFAULT_CONTENT,
  lengthCm: 0,
  widthCm: 0,
  heightCm: 0,
  weightKg: 0,
  declaredValue: 0,
};

/** Una caja por entrada del Detalle (con su embalaje si la talla tiene uno); sin entradas, una vacía. */
export function defaultPackages(entradas: readonly EntradaTalla[], saved: readonly SavedPackage[]): PackageDraft[] {
  if (entradas.length === 0) return [{ ...EMPTY_PACKAGE }];
  return entradas.map((e) => {
    const match = packageForEntrada(e, saved);
    return match ? draftFromSaved(match) : { ...EMPTY_PACKAGE };
  });
}

/** El valor declarado del envío repartido entre las cajas (centavos al último para que sume exacto). */
export function splitDeclaredValue(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / parts);
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? cents - base * (parts - 1) : base) / 100);
}

/** Peso volumétrico (largo × ancho × alto ÷ 5,000, el factor de Paquetexpress y Estafeta en Envia). */
export function volumetricKg(p: Pick<ShipmentPackage, "lengthCm" | "widthCm" | "heightCm">): number {
  return Math.round(((p.lengthCm * p.widthCm * p.heightCm) / 5000) * 100) / 100;
}

// ── Validación de lo que manda la ventana ──────────────────────────────────────

const text = (min: number, max: number, campo: string) =>
  z
    .string()
    .trim()
    .min(min, `Falta ${campo}.`)
    .max(max, `${campo[0]!.toUpperCase()}${campo.slice(1)}: máximo ${max} caracteres.`);

export const destinationSchema = z.object({
  name: text(2, 80, "el nombre de quien recibe"),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .pipe(z.string().regex(/^\d{10}$/, "El teléfono debe tener 10 dígitos.")),
  email: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email("El correo no es válido.").nullable()),
  street: text(2, 100, "la calle"),
  number: text(1, 20, "el número"),
  district: text(2, 100, "la colonia"),
  city: text(2, 80, "la ciudad"),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}$/, "Falta el estado (escribe el código postal)."),
  stateName: z.string().trim().max(60).default(""),
  postalCode: z.string().trim().regex(/^\d{5}$/, "El código postal debe tener 5 dígitos."),
  reference: z.string().trim().max(120, "Referencias: máximo 120 caracteres.").default(""),
}) satisfies z.ZodType<ShipmentDestination, unknown>;

const medida = (campo: string, max: number) =>
  z.coerce.number().positive(`Falta ${campo}.`).max(max, `${campo[0]!.toUpperCase()}${campo.slice(1)}: máximo ${max}.`);

export const packageSchema = z.object({
  packageName: z.string().trim().max(100).nullable(),
  content: text(2, 60, "el contenido"),
  lengthCm: medida("el largo", 300),
  widthCm: medida("el ancho", 300),
  heightCm: medida("el alto", 300),
  weightKg: medida("el peso", 70),
});

export const shipmentInputSchema = z.object({
  contactId: z.string().trim().min(1).max(128),
  destination: destinationSchema,
  packages: z.array(packageSchema).min(1, "Falta al menos un paquete.").max(10, "Máximo 10 paquetes por guía."),
  declaredValue: z.coerce.number().min(0, "El valor declarado no puede ser negativo.").max(1_000_000),
  insured: z.boolean(),
});
export type ShipmentInput = z.input<typeof shipmentInputSchema>;
export type ParsedShipmentInput = z.output<typeof shipmentInputSchema>;

export const createShipmentSchema = shipmentInputSchema.extend({
  requestKey: z.string().uuid(),
  carrier: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/),
  service: z.string().trim().min(1).max(80),
  serviceLabel: z.string().trim().max(120).nullish(),
});
export type CreateShipmentInput = z.input<typeof createShipmentSchema>;

/** Paquetes con su parte del valor declarado (lo que se guarda y se manda a Envia). */
export function packagesWithValue(input: ParsedShipmentInput): ShipmentPackage[] {
  const values = splitDeclaredValue(input.declaredValue, input.packages.length);
  return input.packages.map((p, i) => ({ ...p, declaredValue: values[i] ?? 0 }));
}

/** El primer mensaje de error que entiende el vendedor. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Revisa los datos de la guía.";
}
