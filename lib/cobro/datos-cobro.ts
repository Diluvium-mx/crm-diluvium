// Validación pura de los "Datos de cobro" (Configuración). La CLABE mexicana
// tiene 18 dígitos y un dígito verificador (algoritmo oficial: pesos 3,7,1).
import { z } from "zod";

export function clabeChecksumOk(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += ((Number(clabe[i]) * weights[i % 3]) % 10);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(clabe[17]);
}

const short = (max: number) => z.string().trim().max(max);

export const datosCobroSchema = z.object({
  banco: short(60),
  beneficiario: short(120),
  clabe: z
    .string()
    .transform((v) => v.replace(/\s+/g, ""))
    .refine((v) => v === "" || clabeChecksumOk(v), "La CLABE debe tener 18 dígitos y un dígito verificador válido."),
  cuenta: short(40),
  concepto: short(120),
  notas: short(1_000),
});

export type DatosCobroInput = z.infer<typeof datosCobroSchema>;

// Últimos 4 de la CLABE, para mostrar sin exponerla (vendedores, avisos).
export function clabeMasked(clabe: string): string {
  return clabe.length >= 4 ? `•••• ${clabe.slice(-4)}` : "";
}
