// Lectura de un reporte METAR de aeropuerto (PURO): grados y qué está pasando ahora.
// Formato de la OACI; solo se lee la parte principal, sin observaciones (RMK) ni tendencia
// (TEMPO/BECMG/NOSIG): ahí «RA» puede ser «la lluvia ya terminó» (RAE30) y no lo que pasa ahora.

export const CATEGORIAS = ["tormenta", "lluvia", "llovizna", "niebla", "nublado", "medio_nublado", "despejado"] as const;
export type CategoriaClima = (typeof CATEGORIAS)[number];

/** Las que significan agua cayendo en este momento. */
export const CATEGORIAS_AGUA: ReadonlySet<CategoriaClima> = new Set(["tormenta", "lluvia", "llovizna"]);

// Grupo de fenómeno: intensidad o «en las cercanías» (VC), descriptor y fenómeno(s).
const FENOMENO =
  /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((DZ|RA|SN|SG|IC|PL|GR|GS|UP)+|BR|FG|FU|VA|DU|SA|HZ|PY|SQ|FC|SS|DS)?$/;

function partePrincipal(raw: string): string {
  return raw.split(/\s(?:RMK|TEMPO|BECMG|NOSIG)\b/)[0];
}

/**
 * Grados del reporte: «33/25», «M02/M05» (bajo cero) o «34///» (sin punto de rocío; el JSON del
 * servicio deja la temperatura vacía en ese caso, por eso se lee del reporte original).
 */
export function temperaturaMetar(raw: string): number | null {
  const m = partePrincipal(raw).match(/\s(M?\d{2})\/(?:M?\d{2}|\/\/)?(?=\s|$)/);
  if (!m) return null;
  return m[1].startsWith("M") ? -Number(m[1].slice(1)) : Number(m[1]);
}

/** Qué está pasando en el aeropuerto. Lo que ocurre «en las cercanías» (VC…) no cuenta. */
export function categoriaMetar(raw: string): CategoriaClima {
  const grupos = partePrincipal(raw).split(/\s+/).slice(2); // sin «METAR/SPECI» ni la estación
  const fenomenos = grupos.filter((g) => g.length >= 2 && FENOMENO.test(g) && !g.startsWith("VC"));
  const hay = (re: RegExp) => fenomenos.some((g) => re.test(g));
  if (hay(/TS|GR|GS/)) return "tormenta";
  if (hay(/RA/)) return "lluvia";
  if (hay(/DZ/)) return "llovizna";
  if (hay(/^(FG|BR)$|^(MI|BC|PR)FG$/)) return "niebla";
  const nubes = grupos.map((g) => /^(FEW|SCT|BKN|OVC|VV)\d{3}/.exec(g)?.[1]).filter((n) => n !== undefined);
  if (nubes.some((n) => n === "BKN" || n === "OVC" || n === "VV")) return "nublado";
  if (nubes.includes("SCT")) return "medio_nublado";
  return "despejado";
}
