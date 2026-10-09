> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Luna sin texto: el sufijo y sin Sonnet en las etapas del Modelo 1 (8-oct-2026, sin migración)

- **Qué pasó:** del 4 al 8-oct, Sonnet escribió 80 respuestas en chats de Prospecto porque Luna contestó solo con
  acciones (red contra el silencio → «escribe el otro modelo»): US$1.73, el 39 % de lo que gastó Sonnet en esos días, y
  más caro por respuesta porque Sonnet leía el chat completo por primera vez. Desde el cambio del sufijo del 5-oct
  (12:17 Mazatlán, «texto interno», arriba) Luna se quedaba sin texto el **8.2 %** de las veces (antes 1.7 %): el sufijo
  dejó de decir que el texto va primero y Luna, con herramientas en una sola vuelta, a veces solo llamaba
  `fijar_cotizacion` / `actualizar_detalle`.
- **Capa 1, el sufijo** (`brain.ts`): «Cada respuesta lleva SIEMPRE primero tu texto para el cliente y, en la misma
  respuesta, las herramientas que hagan falta: una respuesta solo con herramientas deja al cliente sin contestar»; lo
  de no escribir nombres de herramientas, JSON ni notas sigue igual. Banco con los 70 casos REALES en que Luna se quedó
  sin texto (`notas/banco-luna-sin-texto`, 2 vueltas, llaves de staging): sufijo del 5-oct 26.4 % sin texto, sufijo
  nuevo 8.6 %; con la segunda vuelta de Luna (abajo), 2.9 %. Texto interno: 1 de 140 en cada sufijo, y el candado de
  `internal-text.ts` detiene los dos. Cambia el prefijo en caché una vez (una escritura de 1 h, centavos).
- **Capa 2, nunca Sonnet por Luna** (decisión del dueño, «por nada del mundo»): en una etapa del Modelo 1,
  `brainCandidates` devuelve SOLO el Modelo 1 (aunque falte su llave: la tarjeta dice qué falta). Respuesta vacía → se
  le pide otra vez a Luna UNA vez con `SIN_RESPUESTA_NOTE` (`run.ts`); si tampoco, tarjeta «El agente no pudo
  responder». Red contra el silencio → escribe otra vez Luna con la nota; si tampoco, aviso `sin_respuesta`. La
  pregunta sin contestar y las letras de otro alfabeto ya usaban el mismo modelo cuando no hay otro. Lo único que
  sigue llevando a Sonnet desde una etapa del Modelo 1 es el **traspaso** (Luna mueve el contacto a una etapa del
  Modelo 2). Las etapas del Modelo 2 no cambian: si Sonnet falla o se queda sin texto, contesta Luna.
- **Efecto:** si Luna (OpenAI) se cae, los chats de Inbox y Prospecto se quedan con la tarjeta en vez de contestar
  con Sonnet. Ahorro estimado: ~US$0.35 al día de Sonnet (80 respuestas en 5 días) a cambio de unas 2 llamadas más de
  Luna al día (~US$0.002).
