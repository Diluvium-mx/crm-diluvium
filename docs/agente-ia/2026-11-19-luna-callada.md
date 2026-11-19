> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Luna callada: el CRM le devuelve «listo» y Luna escribe en la misma conversación (19-nov-2026, sin migración)

Decisión del dueño: **opción A** (19-nov-2026), la forma oficial en que OpenAI espera que se usen sus modelos.
Sonnet en lugar de Luna sigue descartado ([Luna sin texto, 8-oct](2026-10-08-luna-sin-texto-sufijo.md)).

### Qué pasaba

- Del 10 al 17-nov hubo **22 avisos `sin_respuesta`** (2 a 4 al día sobre ~100–200 respuestas): el cliente se quedaba
  sin respuesta hasta que un vendedor veía el aviso gris. Casi siempre justo después de dar un dato que se le pidió
  (si se inunda, la medida, el precio). En `ai_usage` se ven como `outcome = 'sin_texto'`.
- Todo silencio de Luna = una o más acciones sin texto (`actualizar_detalle`, `mover_etapa`, `fijar_cotizacion`,
  workflow). Cuando mueve la etapa, en 16–22 % de las primeras respuestas (medido el 14-nov).
- El reintento (`SIN_RESPUESTA_NOTE`) le preguntaba otra vez desde cero, ya con la nota «contéstale con texto además de
  las acciones», y aun así fallaba más o menos la mitad: las instrucciones solas no bastan.

### La causa

Luna (`gpt-5.6-luna`) es un modelo de razonamiento de OpenAI por la API Responses. OpenAI los diseñó así: cuando piden
una acción **todavía están pensando** y escriben el mensaje final hasta recibir el resultado de esa acción (guía oficial
«Managing Function Calls With Reasoning Models»). El CRM declara las herramientas sin `execute` y hace una sola vuelta
(`stopWhen: isStepCount(1)`), así que nunca le devolvía el resultado: Luna se quedaba esperando. Sonnet (Anthropic)
suele escribir el texto y pedir las acciones en la misma respuesta; por eso le pasa mucho menos.

### Qué cambia

Cuando la respuesta no le manda nada al cliente y quien vuelve a escribir es el **mismo** modelo (las etapas de Luna):

1. El CRM **continúa la misma conversación**: le devuelve **«listo»** por cada acción que pidió (interno; el cliente
   nunca lo ve) y le pide el mensaje con `toolChoice: "none"` (solo puede escribir).
2. Las acciones que cuentan son **todas las de la primera vuelta** (Detalle, etapa, cotización, workflows, avisos,
   link). Lo que pida en la segunda vuelta se ignora: nada se repite ni se pierde.
3. **Si la segunda vuelta llega en blanco:** no sale nada y el vendedor recibe el aviso `sin_respuesta`, como antes. No
   hay tercera llamada.
4. **Si OpenAI rechaza la segunda vuelta** (error): se usa el reintento de siempre, desde cero con la nota. En el peor
   caso queda igual que antes.
5. **Si la segunda vuelta trae texto interno** («[tool call]…»): otra respuesta desde cero con la nota y la de texto
   interno, igual que cualquier respuesta (y el candado de siempre si tampoco).

La segunda vuelta va **sin el razonamiento de Luna ni los ids internos de OpenAI** (`rs_…`, `fc_…`), solo sus llamadas
con su id y el «listo». Con ellos, la API a veces rechaza la petición («reasoning was provided without its required
following item», reportado en el foro de OpenAI y en proyectos con el AI SDK; quitarlos fue el arreglo que aplicaron).
Así la petición es la forma básica que la API siempre acepta.

**Costo:** el mismo número de llamadas que el reintento de antes (una). Las mismas instrucciones, herramientas y
conversación al principio, así que OpenAI la lee de su caché. ~US$0.002–0.003 por caso, que ya se pagaba.

**Qué no cambia:** las etapas del Modelo 2 (si Sonnet se queda sin texto contesta Luna desde cero, como antes), el
traspaso, el acuse, «ya le salió algo al cliente», el Goal y las FAQs (no se tocan: la caché no se vuelve a cobrar).
Solo OpenAI devuelve su respuesta para continuarla (`responseMessages` en `lib/ai/providers/openai.ts`); con otro
proveedor como Modelo 1 queda el reintento de siempre.

### Código

- `lib/ai/runtime/continuacion.ts`: arma la segunda vuelta (`continuationMessages`, `ACCION_LISTA = "listo"`).
- `lib/ai/runtime/run.ts`: `attempt(…, continuar)` y la red contra el silencio (rama «Luna callada»).
- `lib/ai/providers/openai.ts`: `toolChoice` y `responseMessages`; `lib/ai/types.ts`.

### Pruebas (sin modelos reales, regla del dueño)

- `lib/ai/providers/openai.test.ts`: la petición EXACTA que recibe OpenAI en la segunda vuelta (con un `fetch` doble):
  lo que leyó, su llamada, `function_call_output = "listo"`, `tool_choice: "none"`, las mismas herramientas y sin
  `rs_…`/`fc_…`/`item_reference`.
- `lib/ai/runtime/continuacion.test.ts`: «listo» por cada acción, una vez por id; sin respuesta del proveedor no hay
  continuación.
- `lib/ai/runtime/run.int.test.ts` (Postgres real, «Luna callada»): segunda vuelta con texto; el caso de producción
  (Detalle + etapa + cotización una sola vez, lo de la segunda vuelta ignorado); segunda vuelta en blanco → aviso;
  error de OpenAI → reintento de siempre; texto interno → desde cero; proveedor sin respuesta → reintento de siempre.

### Cómo medirlo en producción (solo lectura, con «OK LECTURA PROD»)

En `ai_usage` (etapa `cerebro`), la primera vuelta deja `outcome = 'sin_texto'` y su `error` dice qué pasó:

| `error` empieza con | Significa |
|---|---|
| `sin texto; el CRM le devolvió «listo»…` | La continuación funcionó: el cliente recibió su respuesta |
| `tampoco escribió con «listo» (continuación)…` | La segunda vuelta llegó en blanco: aviso al vendedor |
| `continuación con «listo»: …` (`outcome = 'error'`) | OpenAI rechazó la segunda vuelta; entró el reintento de siempre |
| `sin texto; contesta …` / `tampoco escribió; …` | El camino de antes (otro modelo o proveedor sin continuación) |

Y los avisos: `ai_agent_notices` con `kind = 'sin_respuesta'` por día, antes (10 al 17-nov: 22) y después.
