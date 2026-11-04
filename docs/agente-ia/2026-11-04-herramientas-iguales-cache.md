## Herramientas iguales en todos los chats y el reloj de los toques (4-nov-2026, sin migración)

**Por qué.** El dueño vio bajar el saldo de Anthropic sin casi chats (1.84 → 1.49). Con lectura de producción
(30 días al 4-nov): Anthropic US$20.01, de los que **US$8.53 (43 %) fueron 80 reescrituras completas** de la caché
del Agente IA (~27 mil tokens, ~US$0.11–0.13 cada una). Solo unas 10 eran inevitables (el Goal de las 22:00, la
columna Buen Fin). Las demás venían de dos fallas:

1. **La lista de herramientas cambiaba según el chat.** Anthropic (y OpenAI) guardan en caché primero las
   herramientas, luego el system (Goal + FAQs). Un chat donde «Dónde medir» (máx. 1), la Tabla (máx. 2) o «Entrada
   mayor a 2.5 m» ya llegaron a su máximo, o con lada fuera de México (sin link de pago), mandaba otra lista: la caché
   no coincidía y la respuesta pagaba el Goal completo (54 veces en 30 días con Sonnet; 98 en 14 días con Luna).
2. **El reloj de la renovación se movía con esas respuestas.** Creía que la caché compartida se había tocado,
   se saltaba la renovación y la caché se vencía: la siguiente renovación la volvía a escribir (1-nov: 17:23 US$0.13
   y 18:15 US$0.11).

**Qué cambia.**
- `loadAgentTools` (lib/ai/runtime/actions.ts) arma **la misma lista** en todos los chats y en la renovación. Lo que
  ESTE chat no puede usar va en `blocked` (máximo de envíos, «Solo al inicio» estricto que ya no aplica, link a una
  lada fuera de México o con 3 links ya mandados).
- El modelo lo sabe en el último turno (fuera de la caché): «Herramientas que NO puedes usar en este chat (el CRM no
  las manda): …» (`blockedToolsLine`). La línea de «Máximo por chat» de siempre sigue igual.
- Si aun así pide una bloqueada, **no sale** y se le pide otra respuesta **una vez** con la nota de que no se mandó
  (`blockedRetryNote`; queda una fila `error` en ai_usage: «pidió … que no se puede en este chat»). Si vuelve a
  pedirla, el candado de siempre (acción sin ejecutar) no manda nada y deja la tarjeta al vendedor: nunca sale un
  «se la mando» sin el archivo.
- Reloj de los toques (`goodTouch`, cache-keepalive-core.ts): una respuesta que escribió la caché sin leerla
  mientras había una viva (lectura en la hora anterior) usó OTRA caché y ya no mueve el reloj.
- Los candados del link de pago en `prepareActions` siguen igual (respaldo).

**Lo que NO cambia.** El Goal, las FAQs, las descripciones de las herramientas, el modelo de cada etapa y las reglas
(máximo por chat, solo al inicio, links) son las mismas. Solo cambia dónde se le dice al modelo qué no puede usar.

**Luna (lector en segundo plano): no se toca.** Revisado con la documentación de OpenAI (4-nov): en GPT-5.6 la
caché ya dura 30 min mínimo, `prompt_cache_key` no mejora nada y guardarla 12 h cuesta 2.5× al escribir. El lector
falla la caché sobre todo porque su lista y sus instrucciones cambian entre lecturas con y sin seguimiento; igualarlas
cambiaría lo que Luna lee y ahorraría ~US$1 al mes. El dueño pidió no arriesgar cómo recopila: se queda igual.
Luna cuando CONTESTA (Inbox, Prospecto) sí gana con este cambio, porque usa las mismas herramientas.

**Ahorro estimado:** ~US$6–7 al mes con Sonnet y ~US$0.7 con Luna. Vigilar en producción: reescrituras
(`cache_write_tokens` > 20 mil) por día en ai_usage y filas «pidió … que no se puede en este chat».
