// Lote de lecturas, lado del servidor (auditoría de velocidad B1/B2, 31-oct-2026): corre EN PARALELO las
// lecturas que la pestaña juntó en un solo viaje (lib/inbox/lote-cliente.ts). Next manda las Server Actions
// de una pestaña una por una (node_modules/next/dist/docs/01-app/02-guides/server-actions.md › Sequential
// dispatch): abrir un chat eran ~10 lecturas en fila (~80 ms cada una desde la oficina) y el «Enviar»
// esperaba detrás de ellas. Puro: el registro de lecturas permitidas llega de fuera (lib/inbox/lecturas.ts).
import { z } from "zod";
import { safeErrorMessage } from "@/lib/log/safe-error";
import { MAX_LOTE, type RespuestaLectura } from "@/lib/inbox/lote-tipos";
import { SLOW_ACTION_MS } from "@/lib/monitoring/slow-actions";

/**
 * Una lectura permitida: la Server Action de siempre (`leer`, también da los tipos a la pestaña) y cómo
 * llamarla con lo que llegó del navegador, validado (`ejecutar`).
 */
export type EntradaLectura<A extends unknown[], R> = {
  leer: (...args: A) => Promise<R>;
  ejecutar: (args: unknown[]) => Promise<R>;
};

export function entradaLectura<A extends unknown[], R>(
  leer: (...args: A) => Promise<R>,
  argumentos: (args: unknown[]) => A,
): EntradaLectura<A, R> {
  return { leer, ejecutar: (args) => leer(...argumentos(args)) };
}

const loteSchema = z
  .array(z.object({ nombre: z.string().max(64), args: z.array(z.unknown()).max(4) }))
  .max(MAX_LOTE);

/**
 * Corre cada lectura con su propia Server Action (que saca la organización de la sesión, como siempre) y
 * devuelve las respuestas en el mismo orden. Una que falla (o que no está en el registro) no tumba a las
 * demás; su error queda en el log sin datos de clientes. El log `[lenta]` mide la petición entera
 * (lib/monitoring/slow-actions.ts); aquí sale además CUÁL lectura del lote tardó.
 */
export async function ejecutarLote(
  registro: Readonly<Record<string, { ejecutar: (args: unknown[]) => Promise<unknown> }>>,
  pedidos: unknown,
): Promise<RespuestaLectura[]> {
  const lista = loteSchema.parse(pedidos);
  return Promise.all(
    lista.map(async ({ nombre, args }): Promise<RespuestaLectura> => {
      const entrada = Object.hasOwn(registro, nombre) ? registro[nombre] : undefined;
      if (!entrada) return { ok: false };
      const inicio = performance.now();
      try {
        const valor = await entrada.ejecutar(args);
        const ms = Math.round(performance.now() - inicio);
        if (ms >= SLOW_ACTION_MS) console.warn(`[lenta] lote › ${nombre} ${ms} ms`);
        return { ok: true, valor };
      } catch (error) {
        console.error(`[lecturas] ${nombre} falló: ${safeErrorMessage(error)}`);
        return { ok: false };
      }
    }),
  );
}
