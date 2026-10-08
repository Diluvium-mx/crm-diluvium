// Token del enlace al formulario y código de recomendación de una opinión
// (docs/opiniones.md). Puro.
import { randomBytes, randomInt } from "node:crypto";

/** 128 bits al azar en base64url (22 letras): el enlace no se adivina. */
export function nuevoToken(): string {
  return randomBytes(16).toString("base64url");
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

// Sin 0/O ni 1/I/L: se confunden al leerlo en el celular o al dictarlo.
const LETRAS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Prefijo del código según el nombre de la organización: «Diluvium» → «DILU». */
export function prefijoCodigo(nombreOrganizacion: string): string {
  const letras = nombreOrganizacion
    .normalize("NFD")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  return letras.slice(0, 4) || "REF";
}

/** Código de recomendación, p. ej. «DILU-4K7P». `azar` se inyecta en las pruebas. */
export function nuevoCodigo(prefijo: string, azar: (max: number) => number = randomInt): string {
  let sufijo = "";
  for (let i = 0; i < 4; i++) sufijo += LETRAS[azar(LETRAS.length)];
  return `${prefijo}-${sufijo}`;
}
