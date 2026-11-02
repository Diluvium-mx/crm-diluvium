// Fotos y PDF que ve el Agente IA (A3 de la auditoría de velocidad, 2-nov-2026): van al modelo como URL firmada.
// Antes la firma cambiaba en cada respuesta (15 min desde ese instante) y el modelo no podía reutilizar lo que ya
// había leído del chat a partir de la primera foto: con foto en el chat Luna tardaba 4.1 s en vez de 2.7 s y
// reutilizaba 75 % en vez de 89 % (medido 31-oct). Ahora se firma con la hora redondeada: la misma URL toda esa
// hora (cambia una vez por hora) y vale 2 h desde la hora redonda, o sea, al menos 1 h desde que se pide.
export const FIRMA_IMAGEN_HORA_MS = 60 * 60_000;
export const FIRMA_IMAGEN_VIGENCIA_S = 2 * 60 * 60;

/** Hora con la que se firma: la hora redonda anterior (UTC). */
export function horaDeFirma(now: Date): Date {
  return new Date(Math.floor(now.getTime() / FIRMA_IMAGEN_HORA_MS) * FIRMA_IMAGEN_HORA_MS);
}
