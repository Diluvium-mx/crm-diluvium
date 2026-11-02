> Parte de [Agente IA](../agente-ia.md) (índice con todas las decisiones).

## Respuesta más rápida: preparar durante la espera, anuncio limpio antes y fotos con firma estable (2-nov-2026, sin migración)

Auditoría de velocidad del 31-oct (`~/Documents/Diluvium CRM/reportes/estado-crm/velocidad-crm-2026-10-31.md`, puntos
A1, A2 y A3; OK del dueño). Medido en producción (7 días): la primera burbuja salía p50 18.1 s después del último
mensaje del cliente: 15 s de espera de la ráfaga (decisión del dueño: no se toca) + ~3 s del modelo. Nada de esto cambia
lo que contesta el Agente IA; solo cuándo.

**A1 · Preparar la respuesta durante la espera.** El job se programa `ANTICIPO_MS` (3 s, `policy.ts`) antes de que se
cumpla la espera (`schedule.ts › jobDelayFor`; también el reintento: `rescheduleDelayFor`). El modelo escribe mientras
tanto y la respuesta lista espera en `run.ts` (`RunDeps.holdUntil`, en producción hasta 60 s) a la hora de siempre
(`fireAtFor`: la espera tras el último entrante, o el tope de 60 s desde el primero). Luego, como antes, se revisa si el
cliente volvió a escribir. Si escribió, esa respuesta no sale (`discarded_stale`) y se vuelve a la espera normal desde su
último mensaje (`reschedule` «mensajes_nuevos_durante_generacion»); antes se regeneraba al momento. La respuesta nunca sale
antes que antes. Costo: una respuesta se descarta si el cliente escribe en los 3 s antes de la hora (antes, en los ~3 s
después); en octubre fueron ~30 descartes por semana. Un mensaje que llega justo después de la hora ya no se junta: recibe
su propia respuesta.

**A2 · El anuncio se limpia durante la espera.** El primer mensaje de quien llega por un anuncio de Click-to-WhatsApp se
limpiaba con Luna en fila justo antes de contestar (+2.2 s, ~240 por semana). Ahora el worker lo manda limpiar en cuanto
llega el mensaje (`ad-cleaner.ts › prelimpiarAnuncios`, sin esperarlo), solo si el Agente IA lo va a contestar (canal
encendido, chat con Agente IA, agente activo). Si al contestar la limpieza sigue en camino, la respuesta la espera en vez
de pedirla otra vez (misma promesa por mensaje, en el proceso). El resultado se guarda en el mensaje como siempre.

**A3 · Fotos y PDF con firma estable.** Las fotos que ven el Agente IA y el lector van al modelo como URL firmada, que
antes cambiaba en cada llamada (15 min desde ese instante): el modelo no podía reutilizar lo que ya había leído del chat
a partir de la primera foto (Luna con foto en el chat: 4.1 s y 75 % de caché, contra 2.7 s y 89 % sin foto). Ahora se
firman con la hora redonda (`firma-imagen.ts`, `signingDate` en `lib/storage/s3.ts`): la misma URL toda esa hora, válida
2 h desde la hora redonda. El punto de caché del historial de Anthropic ya no se corta antes de la primera foto
(`lib/ai/providers/anthropic-cache.ts`); solo al cambiar la hora se vuelve a escribir.

**Vigilar en producción:** `ai_usage` con `outcome = 'discarded_stale'` por semana (debería quedar parecido a ~30), la
latencia de Luna con foto en el chat (debería bajar hacia ~3 s) y el tiempo de la primera burbuja (p50 esperado ~15–16 s
desde que el CRM guarda el mensaje, antes 18.1 s).

Pruebas: `policy.test.ts` (hora de salida y anticipo), `run.int.test.ts` (A1: espera a la hora y descarte si el cliente
escribe; A2: limpieza adelantada, una sola por mensaje y nada con el canal apagado), `firma-imagen.test.ts` y
`anthropic-cache.test.ts`. Sin bancos con modelos (regla del 9-oct).
