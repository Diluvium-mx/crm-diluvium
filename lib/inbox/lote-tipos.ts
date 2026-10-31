// Lo que comparten la pestaña (lote-cliente.ts) y el servidor (lote-servidor.ts) del lote de lecturas, sin
// importar nada: así el navegador no carga la validación ni los logs del servidor.

/** Tope de lecturas por viaje; la pestaña parte en tandas de este tamaño. */
export const MAX_LOTE = 20;

export type PedidoLectura = { nombre: string; args: unknown[] };
/** Sin el error: la pestaña solo sabe que esa lectura no salió, como con una Server Action suelta. */
export type RespuestaLectura = { ok: true; valor: unknown } | { ok: false };
