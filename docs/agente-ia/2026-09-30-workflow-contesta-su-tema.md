> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## El workflow contesta SU tema; el Agente IA, lo que falte (30-sep-2026, sin migración)

Caso del 29-sep (6:22 p.m. Mazatlán): «De que cd son y que precio tienen» disparó «Precio 2» por "precio". El
workflow contestó el precio y terminó con su pregunta; su marca `contestaA` dejó el mensaje **entero** como contestado y
nadie le dijo de qué ciudad somos (el agente, después, solo preguntó el nivel del agua). Pedido del dueño: «si tenemos un
Agente IA es porque debe ser inteligente».

- El último mensaje de una corrida por **palabra clave** con «El workflow es la respuesta» lleva, junto a `contestaA`, la
  marca **`revisaAgente`** (`markAnswersOnly`, `ANSWERS_ONLY_REVIEW_KEY`). Con ella, `answeredOnlySql` (pendientes y
  barrido) solo da el mensaje por contestado cuando el **Agente IA ya lo revisó** (resultado final en `ai_usage` para ese
  mensaje). Las marcas viejas (sin `revisaAgente`) siguen como antes: al desplegar no se revisa historia.
- **Modo complemento** (`lib/ai/runtime/complement.ts`, `run.ts`): el agente sigue esperando a que termine la corrida
  (`answerRunInFlight`); luego, si ese mensaje es el **último** del cliente, recibe en el contexto del CRM la nota
  «El workflow «X» ya le contestó…: contesta solo lo que el workflow no cubrió, sin repetirlo y **sin hacer preguntas**
  (ahora le toca contestar al cliente); si no falta nada, escribe exactamente `[NADA_QUE_AGREGAR]`». Esa señal
  (`NOTHING_TOKEN`, `parseBrainOutput` → `nothing`) no manda nada al cliente y no deja aviso: la red contra el silencio
  la ve como «ya le salió algo al cliente» (`contestado`). En el complemento, una respuesta **en blanco** cuenta igual
  (con el Goal real de staging, Luna y Sonnet a veces contestan vacío en vez de la señal); fuera del complemento, la
  señal sola o el blanco son respuesta vacía (tarjeta, como siempre).
- **Prueba con modelos reales (30-sep, Goal y FAQs de staging, sin enviar):** 6 mensajes × Luna y Sonnet, 12 de 12
  bien: «De que cd son y que precio tienen» → «Somos de Los Mochis, Sinaloa»; «Cuánto cuesta y en cuántos días llega a
  Monterrey?» → «3 a 5 días hábiles»; «Precio? se puede pagar a meses?» → «6 meses sin intereses»; «Precio», «Quiero
  información» y «Hola buenas tardes, qué precio tienen?» → nada.
- **Sin preguntas** (`withoutClosingQuestions`): del complemento se quita la pregunta final de cada mensaje y los que
  solo eran pregunta, para que la del workflow siga siendo la última («Somos de Los Mochis… ¿De dónde nos escribe?» →
  sale solo la primera parte; lo que no sale queda en `ai_usage.error`).
- Si el cliente ya **siguió escribiendo** (p. ej. contestó «Sí» antes de la revisión), el agente contesta todo junto
  como siempre (con pregunta), con la nota de no repetir lo que ya dijo el workflow (`partialNote`).
- Ráfaga («¿Cuánto tarda el envío?» + «Precio»): ahora el agente lee los dos en modo complemento y contesta lo del
  envío sin repetir el precio; el uso queda ligado al disparador.
- Costo: una llamada más al modelo por cada workflow «es la respuesta» por palabra clave (casi siempre al inicio, con el
  Modelo 1). Orden: la aclaración del agente sale **después** de la pregunta del workflow (~15–20 s, la espera normal del
  agente); que salga antes quedaría como mejora aparte (la pregunta esperaría al agente).
- Como **herramienta** del Agente IA con textos («Depende»), su propio texto sigue sin salir; quedaba pendiente el
  complemento (en ese momento ningún workflow con textos tenía «El Agente IA puede dispararlo»). **Resuelto el
  9-oct-2026:** con textos o con archivos, también hay complemento (ver «Workflow «es la respuesta» con textos pedido
  por el Agente IA»).
