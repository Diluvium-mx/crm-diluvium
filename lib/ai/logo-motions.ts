import { MODEL_LOGO_IDS } from "./logos";
import type { ModelLogo } from "./types";

// Movimiento del logo al pasar el mouse (o llegar con Tab) por la tarjeta de un modelo en
// Agente IA › Modelos (28-sep-2026). Cada vez que se abre la página, cada marca recibe uno
// al azar con dos reglas: dos marcas nunca comparten movimiento y ninguna repite el de la
// vez anterior (lo recuerda el navegador de cada quien). Todos terminan donde empezaron,
// así que sirven para cualquier logo. El CSS de cada uno vive en app/globals.css
// ([data-motion]). PURO: el azar entra como parámetro para poder probarlo.
export const LOGO_MOTIONS = ["salto", "elevar", "vuelta", "pulso", "destello", "meneo", "latido"] as const;
export type LogoMotion = (typeof LOGO_MOTIONS)[number];
export type LogoMotions = Partial<Record<ModelLogo, LogoMotion>>;

// Llave del navegador (localStorage) con el sorteo anterior.
export const LOGO_MOTIONS_STORAGE_KEY = "crm:agente-ia:movimientos-logos";

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Reparte un movimiento por marca. Con 7 movimientos y 5 marcas las dos reglas siempre se
// cumplen (a la última marca le quedan al menos 2 opciones). Si algún día hubiera más
// marcas que eso, primero se suelta "no repetir el anterior" y después "no compartir".
export function assignLogoMotions(
  previous: LogoMotions = {},
  random: () => number = Math.random,
  logos: readonly ModelLogo[] = MODEL_LOGO_IDS,
): LogoMotions {
  const used = new Set<LogoMotion>();
  const out: LogoMotions = {};
  for (const logo of shuffled([...new Set(logos)], random)) {
    const options = shuffled(LOGO_MOTIONS, random);
    const pick =
      options.find((m) => !used.has(m) && m !== previous[logo]) ?? options.find((m) => !used.has(m)) ?? options[0];
    used.add(pick);
    out[logo] = pick;
  }
  return out;
}

// Lee el sorteo guardado; cualquier cosa rara (JSON roto, marca o movimiento que ya no
// existe) se ignora.
export function parseLogoMotions(raw: string | null): LogoMotions {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out: LogoMotions = {};
  for (const logo of MODEL_LOGO_IDS) {
    const value: unknown = (data as Record<string, unknown>)[logo];
    if (typeof value === "string" && (LOGO_MOTIONS as readonly string[]).includes(value)) out[logo] = value as LogoMotion;
  }
  return out;
}
