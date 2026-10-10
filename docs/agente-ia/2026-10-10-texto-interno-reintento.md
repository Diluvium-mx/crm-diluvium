> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Texto interno: otra respuesta automática antes de la tarjeta (10-oct-2026, sin migración)

- **Qué pasó (7 → 10-oct):** 10 respuestas de GPT-5.6 Luna se detuvieron por texto interno (el candado del 5-oct,
  [texto interno](2026-10-05-texto-interno-sin-completar.md)); al cliente no le llegó nada, pero cada una dejó la
  tarjeta y el chat en pausa hasta que un vendedor entrara (caso del 9-oct: «Si» al poste de una entrada de 4 m y
  la clienta preguntó «¿En cuánto me saldría?» sin respuesta). Dos familias:
  1. **7 notas de «herramienta»** después de una respuesta buena (130–316 tokens de salida): «[tool]», «[tool call]»,
     «(update tool after written)», «[tool call?] Need tool update after written…». Casi siempre justo cuando el
     cliente da un dato (medida, número de puertas): Luna escribe que va a llamar `actualizar_detalle` en vez de
     llamarla. Empezó 18 minutos después del sufijo del 8-oct ([Luna sin texto](2026-10-08-luna-sin-texto-sufijo.md),
     «primero tu texto y, en la misma respuesta, las herramientas»): 0 del 5 al 8-oct, ~0.7 % de las respuestas de
     Luna desde entonces. Ninguna de Sonnet.
  2. **3 señales de no contestar con espacios**, «[ NADA_QUE_AGREGAR ]», ante «Ok» / «Gracias por responder»: lo
     correcto era no contestar, pero el CRM solo reconocía `[NADA_QUE_AGREGAR]` exacto y el candado la tomó como nota
     entre corchetes.
- **A. Otra respuesta del mismo modelo, una vez** (`run.ts` › `attempt`): si la respuesta trae texto interno, el CRM
  se la vuelve a pedir al MISMO modelo con `INTERNAL_TEXT_RETRY_NOTE` (`internal-text.ts`): «no se le envió… escribe
  otra vez solo lo que el cliente debe leer; si hace falta una acción, llama su herramienta en esta misma respuesta».
  La nota va en el contexto del último mensaje (la caché no cambia) y no repite el texto malo. Las acciones de la
  respuesta mala no se ejecutan (las pide la nueva). Si la nueva sale limpia, se envía sin tarjeta ni pausa; si
  también trae texto interno, la tarjeta y la pausa de siempre. Vale para toda llamada al cerebro (respuesta normal,
  traspaso, red contra el silencio, pregunta sin contestar). Nunca otro modelo (Luna no se cambia por Sonnet).
  Costo: una llamada más de Luna solo cuando pasa (~US$0.002; ~3 al día con la tasa actual).
- **B. La respuesta completa en el registro:** la fila de `ai_usage` del intento detenido guarda hasta 500 caracteres
  de la respuesta (renglones unidos con « ⏎ »), en el reintento («texto interno (…); se pide otra respuesta —
  respuesta: «…»») y en el que llega a la tarjeta («no salió: texto interno (…): … — respuesta: «…»»). Antes solo
  quedaba el renglón malo.
- **Señales tolerantes** (`brain.ts` › `parseBrainOutput`): `[NADA_QUE_AGREGAR]` y `[TRANSFERIR]` se reconocen con
  espacios, guiones bajos o minúsculas de más («[ NADA_QUE_AGREGAR ]», «[nada que agregar]»). Las reglas de cuándo
  valen no cambian (acuse o complemento de un workflow).
- **Sin cambio:** el sufijo del CRM (cambiarlo sin banco no se puede medir; el reintento cubre el caso), los 6
  patrones del candado y el último candado de `send.ts`.
- **Revisar en prod después de publicar:** filas de `ai_usage` con «se pide otra respuesta» y cuántas terminaron en
  «no salió: texto interno».
