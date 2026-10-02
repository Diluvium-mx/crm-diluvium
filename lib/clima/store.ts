// La foto del clima vive en Redis (como la de las cuentas de WhatsApp, lib/monitoring/account-health.ts):
// la escribe el worker cada hora y la leen la barra y su actualización. No es dato de ninguna
// organización ni de clientes: el mismo clima para todos, que se renueva solo; sin tabla ni migración.
// Si Redis falla o tarda más de 300 ms, la cinta simplemente no sale: nunca frena una página.
import { z } from "zod";
import { redis } from "@/lib/redis";
import { CATEGORIAS } from "./metar";
import type { FotoClima } from "./armar";

const CLAVE = "clima:cinta:v1";
const VIGENCIA_S = 6 * 3600;
// Redis en Railway responde en 1–2 ms: si tarda más, la página no espera y la cinta no sale.
const TIMEOUT_LECTURA_MS = 300;

const fotoSchema = z.object({
  generado: z.string(),
  ciudades: z.array(
    z.object({
      nombre: z.string(),
      orden: z.number(),
      lat: z.number(),
      lon: z.number(),
      temp: z.number(),
      categoria: z.enum(CATEGORIAS),
      metarHora: z.string(),
      mm: z.number(),
      mmHora: z.string(),
    }),
  ),
  fuera: z.array(z.object({ nombre: z.string(), motivo: z.string() })),
});

export async function guardarFotoClima(foto: FotoClima): Promise<void> {
  await redis.set(CLAVE, JSON.stringify(foto), "EX", VIGENCIA_S);
}

export async function leerFotoClima(): Promise<FotoClima | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      redis.get(CLAVE),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_LECTURA_MS);
      }),
    ]);
    if (!raw) return null;
    const foto = fotoSchema.safeParse(JSON.parse(raw));
    return foto.success ? foto.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
