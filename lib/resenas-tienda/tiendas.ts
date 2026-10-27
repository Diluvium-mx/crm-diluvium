// Las tiendas en línea donde también se vende la compuerta (27-oct-2026, docs/opiniones.md
// § Amazon y Mercado Libre). PURO: qué tiendas nombra un texto y la frase del cliente que
// respalda lo que anotó el lector.
import { normalizeSearch } from "@/lib/text/search";

export const TIENDAS = ["amazon", "mercado_libre"] as const;
export type Tienda = (typeof TIENDAS)[number];

export const TIENDA_NOMBRE: Readonly<Record<Tienda, string>> = {
  amazon: "Amazon",
  mercado_libre: "Mercado Libre",
};

// por_pedir → pedida → la_dejo | no_quiso. «descartada» = el vendedor dice que no compró ahí
// (el lector ya no lo vuelve a anotar).
export const ESTADOS_RESENA = ["por_pedir", "pedida", "la_dejo", "no_quiso", "descartada"] as const;
export type EstadoResena = (typeof ESTADOS_RESENA)[number];

export function esTienda(v: unknown): v is Tienda {
  return typeof v === "string" && (TIENDAS as readonly string[]).includes(v);
}

// Sobre el texto ya sin acentos ni mayúsculas. «ML» y «meli» son como le dicen a Mercado Libre.
const NOMBRES: Readonly<Record<Tienda, RegExp>> = {
  amazon: /\bamazon\b/,
  mercado_libre: /\bmercado\s*libre\b|\bmercadolibre\b|\bmeli\b|\bml\b/,
};

/** Las tiendas que nombra el texto (vacío si ninguna). */
export function tiendasNombradas(texto: string): Tienda[] {
  const t = normalizeSearch(texto);
  return TIENDAS.filter((tienda) => NOMBRES[tienda].test(t));
}

/** El ÚLTIMO texto del cliente que nombra la tienda (lo que se ve en la lista), recortado. */
export function fraseDeTienda(textosDelCliente: readonly string[], tienda: Tienda, max = 300): string | null {
  for (let i = textosDelCliente.length - 1; i >= 0; i--) {
    const texto = textosDelCliente[i].replace(/\s+/g, " ").trim();
    if (texto && tiendasNombradas(texto).includes(tienda)) return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
  }
  return null;
}
