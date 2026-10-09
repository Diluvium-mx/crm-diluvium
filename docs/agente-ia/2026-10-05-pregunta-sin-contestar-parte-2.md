> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Pregunta sin contestar, parte 2: la pregunta sola tampoco se repite (5-oct-2026, sin migración)

- **Por qué volvió a pasar (3-oct 20:21Z → 5-oct):** 3 veces, las 3 tras «Información» (termina con «¿Usted tiene
  problemas de inundaciones?»): el cliente volvió a escribir «Quiero más información» (2) o contestó indirecto («ha
  estado lloviendo mucho») y el modelo respondió SOLO la misma pregunta. El candado la dejaba salir por la regla «si no
  queda nada, sale tal cual» (nunca silencio). Antes del arreglo: 22 en 246 chats; después: esas 3 en 261. El candado
  quitó la pregunta 15 veces. Las 14 preguntas parecidas con otras palabras eran aclaraciones válidas.
- **Ahora** (`run.ts`, después de la red contra el silencio; `onlyRepeatsLastQuestion`, `isBareAck`, `repeatNote` en
  `unanswered.ts`): si la respuesta es solo la pregunta repetida (y ningún workflow suyo le manda algo), se pide otra
  respuesta con una nota (otro modelo; si no hay, el mismo). Si tampoco escribe algo distinto, no sale nada y el
  vendedor recibe el aviso amarillo `sin_respuesta` («El Agente IA solo iba a repetir la pregunta…»); sus acciones
  (Detalle, etapa, avisos) se conservan. Excepción: si el cliente solo mandó un acuse («ok», «va», «gracias», emojis,
  sticker; «sí» NO cuenta), la pregunta sí sale. `ai_usage.outcome = 'repite_pregunta'` (no final) marca la respuesta
  descartada. Costo: una llamada extra solo en estos casos (~1–2 al día).
- **Goal** (aprobado el 5-oct, con Historial): en PREGUNTA SIN CONTESTAR, «hablar de la lluvia o del agua en su casa»
  cuenta como respuesta, y si el cliente vuelve a pedir información que ya recibió se le explica algo nuevo (cómo
  funciona, cómo se instala, de qué está hecha), sin pregunta, con prioridad sobre PRIMER CONTACTO. Prueba sintética:
  solo-la-pregunta 2/6 → 0/6.
