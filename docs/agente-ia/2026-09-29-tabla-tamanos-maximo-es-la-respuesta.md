> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Tabla de tamaños, «Máximo por chat» y «El workflow es la respuesta» (29-sep-2026, migración 0051)

Datos de prod (26–29 sep): la Tabla por palabra clave salió 57 veces, 12 a media conversación (5 falsos: «Checare
medidas», «Voy a tomar medidas y le aviso»…); el Agente IA escribía los tamaños en texto porque su «Cuándo usarlo»
decía «Responde primero su duda en texto»; «precio» y «medidas» juntos en un mensaje, 7 veces (ganaba la Tabla).
Decisiones del dueño:

- **Tercera opción de «¿Cuándo se dispara…?»** (`workflows.trigger_start_only_agent`, `startScopeOf` en
  `lib/workflows/steps.ts`): «Solo al inicio por palabra clave; el Agente IA cuando haga falta». La palabra clave es
  **acción inicial** (misma regla de «Solo al inicio»: antes de que el Agente IA con texto propio o un vendedor
  contesten, una vez por contacto) y después el Agente IA la manda **por contexto**. Las otras dos opciones no
  cambian (la estricta nace así en todos: «Precio 2», «Información»). `startOnlyApplies`: la palabra clave siempre;
  el Agente IA solo en la estricta; comando y etapa del vendedor nunca.
- **«Máximo de envíos por chat»** (`workflows.max_sends_per_chat`, `lib/workflows/max-per-chat.ts`; vacío = sin
  límite; la Tabla = 2). Cuenta lo que YA SALIÓ en la conversación: el **archivo** del workflow (salientes no fallidos
  con ese `storageKey`, **aunque haya salido dentro de otro workflow**: la foto de «Precio 2» o «Información» cuenta)
  o, sin archivos, sus corridas que mandaron algo. Frena a la **palabra clave** y al **Agente IA**: no compite por la
  palabra clave, no se ofrece como herramienta, se omite al crear la corrida (`maximo_por_chat`, cuenta también lo que
  va en cola) y otra vez al arrancarla. El **comando del vendedor** (/tamaños) suma pero **puede pasarlo**. El Agente IA
  lo ve en el contexto del CRM: «… se ha enviado 1 de 2 veces en este chat» / «ya se envió 2 de 2 veces: ya no se puede
  volver a mandar».
- **«El workflow es la respuesta»** (`workflows.is_answer`, casilla del editor) **reemplaza** la regla automática del
  28-sep («si termina en pregunta, el agente espera»): una sola regla que se ve en pantalla (cambiar el último texto ya
  no cambia el comportamiento sin que nadie lo note). La migración la marcó en los que ese día terminaban en pregunta
  («Precio 2», «Información», «Tenemos»), así nada cambió para ellos; el editor avisa si un workflow termina en «?» y no
  la tiene. Con la casilla:
  - **Por palabra clave**: el Agente IA espera mientras la corrida va en camino (`answerRunInFlight`, cada 5 s, tope
    3 min) y su último mensaje contesta **solo el mensaje que lo disparó** (`metadata.contestaA`, `markAnswersOnly`),
    aunque termine en imagen (la Tabla). Después el agente espera la respuesta del cliente.
  - **Como herramienta del Agente IA** (decisión «Depende»): si el workflow trae **textos** («Precio 2»), el texto del
    modelo **no sale** (no se le dice lo mismo dos veces; queda en `ai_usage.error`) y el último mensaje del workflow
    contestaba todo lo que el agente leyó (`respondeHasta`); **desde el 9-oct-2026** contesta solo el mensaje que lo pidió
    y después el agente revisa el mismo mensaje (complemento; ver «Workflow «es la respuesta» con textos pedido por el
    Agente IA»). Si el workflow no arranca, aviso 🤖 al vendedor con el texto que no salió. Si solo manda **archivos** (la Tabla), el agente sí escribía su frase; del 1 al 8-oct-2026 iba como
    **pie de la imagen**, en un solo mensaje. **Desde el 9-oct-2026** su frase tampoco sale: el archivo lleva el pie del
    workflow y después el agente revisa el mismo mensaje (ver «Workflow «es la respuesta» de solo archivos pedido por el
    Agente IA»).
- **Bug de la ráfaga (arreglado):** la pregunta final marcaba `respondeHasta` con la hora del disparador y cerraba
  también lo anterior de la misma ráfaga (29-sep 11:01 Mazatlán: «¿Cuánto tarda el envío?» + «Precio» → «Precio 2»
  contestó y lo del envío quedó sin respuesta). Ahora `contestaA` cierra un solo mensaje: `pendingInbound` y el barrido
  (`answeredOnlySql`) lo excluyen y lo demás sigue pendiente; el agente lo contesta al terminar la corrida.
- **Regla fija «precio y medidas»** (`lib/workflows/fixed-rules.ts`, no se ve en el editor): si al inicio un mensaje
  dispararía «Precio 2» (`precio_2_6100`) y la Tabla (`tabla_tamanos_estandar`) a la vez, sale **«Información»**
  (`informacion_8b3c`: explicación + foto + precio + pregunta). Si «Información» no puede salir (ya salió, ya no es el
  inicio, llegó a su máximo), se decide como siempre. **Alternativa acordada si falla:** «palabras combinadas» en el
  editor (p. ej. «precio + medidas»).
- **Una sola respuesta de inicio por cliente (30-sep-2026, decisión del dueño):** revisión de las corridas reales del
  29–30 sep: en 7 chats salieron dos workflows de inicio seguidos porque «Solo al inicio» no contaba lo que manda otro
  workflow (5 Tabla → «Precio 2» con la misma foto; «Información» → «Precio 2» a 2 s; «Información» → Tabla por «…checo
  las medidas»). Ahora, si a un contacto ya le salió un workflow «Solo al inicio» (cualquiera de las dos opciones), los
  demás «Solo al inicio» ya no salen por palabra clave (ni por el Agente IA en la opción estricta); lo siguiente lo
  contesta el Agente IA, que sigue teniendo la Tabla como herramienta. Cuenta en cualquier conversación y aunque la otra
  esté en cola. Motivo en Corridas: `ya_salio_otra_de_inicio` («ya le salió otra respuesta de inicio»). Se revisa al
  elegir la palabra clave, al ofrecer herramientas, al crear la corrida y al arrancarla (`start-only.ts`,
  `startOnlyEligible` / `startOnlyBlock`). Los workflows sin «Solo al inicio» ni cuentan ni se frenan; el comando del
  vendedor sale siempre.
- **Bug de la marca (arreglado el 30-sep):** si el candado anti-repetición quitaba la pregunta final de un workflow «es
  la respuesta» (porque otro workflow de la misma ráfaga ya la había mandado igual), la marca `contestaA` se perdía: el
  mensaje quedaba sin contestar y el Agente IA preguntaba encima (30-sep 12:31, «Hola costos»). Causa: la marca dependía
  de que el ÚLTIMO paso saliera. Ahora marca el último mensaje que la corrida SÍ mandó (`lastSentMessageOf` en el
  ejecutor); si no mandó nada, no hay marca y lo atiende el Agente IA.
- Textos del dueño (aprobados, se ponen en prod con Historial): «Cuándo usarlo» de la Tabla (no escribir la lista de
  tamaños: la imagen es la referencia; con la medida del cliente, decir qué tamaño le queda) y una excepción en el Goal
  (si vuelve a pedir la tabla, mandarla con su herramienta).
