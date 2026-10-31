"use server";

// Server Action del lote de lecturas (lib/inbox/lote-servidor.ts): UNA sola acción en la fila de la pestaña
// en vez de una por lectura. Cada lectura revisa la sesión por su cuenta (lib/inbox/lecturas.ts).
import { LECTURAS } from "@/lib/inbox/lecturas";
import { ejecutarLote } from "@/lib/inbox/lote-servidor";
import type { RespuestaLectura } from "@/lib/inbox/lote-tipos";

export async function leerLote(pedidos: unknown): Promise<RespuestaLectura[]> {
  return ejecutarLote(LECTURAS, pedidos);
}
