export type LineaCompuerta = "mini" | "estandar";

export type SizeRange = {
  linea: LineaCompuerta;
  talla: string;
  minCm: number;
  maxCm: number;
  posicion: number;
};

export const DEFAULT_SIZE_RANGES: readonly SizeRange[] = [
  { linea: "mini", talla: "XXCH", minCm: 62, maxCm: 70, posicion: 1 },
  { linea: "mini", talla: "XCH", minCm: 71, maxCm: 79, posicion: 2 },
  { linea: "mini", talla: "CH", minCm: 80, maxCm: 88, posicion: 3 },
  { linea: "mini", talla: "M", minCm: 89, maxCm: 97, posicion: 4 },
  { linea: "mini", talla: "G", minCm: 98, maxCm: 106, posicion: 5 },
  { linea: "mini", talla: "XG", minCm: 107, maxCm: 115, posicion: 6 },
  { linea: "mini", talla: "XXG", minCm: 116, maxCm: 123, posicion: 7 },
  { linea: "estandar", talla: "Estándar", minCm: 69, maxCm: 120, posicion: 1 },
  { linea: "estandar", talla: "A la medida", minCm: 121, maxCm: 250, posicion: 2 },
];

export function suggestSize(
  anchoCm: number | null,
  linea: LineaCompuerta,
  ranges: readonly SizeRange[],
): string | null {
  if (anchoCm === null) return null;

  const match = ranges
    .filter(
      (range) =>
        range.linea === linea && anchoCm >= range.minCm && anchoCm <= range.maxCm,
    )
    .sort((a, b) => a.posicion - b.posicion)[0];

  return match?.talla ?? null;
}

export function validateSizeRanges(ranges: readonly SizeRange[]): string[] {
  const errors: string[] = [];
  const namesByLine = new Map<LineaCompuerta, Set<string>>();

  for (const range of ranges) {
    const talla = range.talla.trim();
    if (!talla) {
      errors.push(`La talla de la línea ${range.linea} no puede estar vacía.`);
    } else {
      const names = namesByLine.get(range.linea) ?? new Set<string>();
      const normalized = talla.toLocaleLowerCase("es-MX");
      if (names.has(normalized)) {
        errors.push(`La talla "${talla}" está duplicada en la línea ${range.linea}.`);
      }
      names.add(normalized);
      namesByLine.set(range.linea, names);
    }

    if (range.minCm <= 0) {
      errors.push(`La talla "${talla || "sin nombre"}" debe tener un mínimo mayor que 0.`);
    }
    if (range.minCm > range.maxCm) {
      errors.push(`La talla "${talla || "sin nombre"}" tiene un mínimo mayor que su máximo.`);
    }
  }

  for (const linea of ["mini", "estandar"] as const) {
    const validRanges = ranges
      .filter((range) => range.linea === linea && range.minCm > 0 && range.minCm <= range.maxCm)
      .sort((a, b) => a.minCm - b.minCm || a.maxCm - b.maxCm || a.posicion - b.posicion);

    for (let i = 0; i < validRanges.length; i += 1) {
      for (let j = i + 1; j < validRanges.length; j += 1) {
        const previous = validRanges[i];
        const current = validRanges[j];
        if (current.minCm <= previous.maxCm) {
          errors.push(
            `Las tallas "${previous.talla}" y "${current.talla}" se enciman en la línea ${linea}.`,
          );
        }
      }
    }
  }

  return errors;
}
