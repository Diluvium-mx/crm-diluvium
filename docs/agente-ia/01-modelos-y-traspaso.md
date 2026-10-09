> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Modelos (Fase A → Fase E)

Filtro (limpia el anuncio): **GPT-5.6 Luna**. Desde la Fase E el cerebro son **dos
modelos por etapa**: Modelo 1 (default **GPT-5.6 Luna**; Inbox, Prospecto, Interesado) y
Modelo 2 (default **Claude Sonnet 5**; Cerca de compra y Compra). Cualquiera de los dos
se elige entre: GPT-5.6 Luna, Claude Sonnet 5, GPT-5.6 Terra, GPT-5.6 Sol, GPT-6.1 Sol,
Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 4.5, Gemini 3.8 Flash, Grok 4.6 y Qwen 3.7
Flash (GPT-6.1 Sol y Claude Sonnet 5.5 desde el 29-sep-2026, con la etiqueta «Nuevo»; se probaron
con las llaves de staging: id de API, texto al cliente junto con las acciones y lectura de PDF).
Los tres últimos salen en
gris hasta que su llave esté en Railway (y no se pueden guardar sin ella). Si el Modelo 1 no
tiene llave en un entorno, contesta el Modelo 2; si un vendedor cambia la etapa mientras el
agente escribe y eso cambia de modelo, la respuesta se descarta y se regenera con el correcto.
Qwen no lee PDF: un comprobante en PDF le llega como nota de texto. Precios internos
(`lib/ai/pricing.ts`, fuentes en el archivo): Gemini 3.8 Flash 0.75 / 3.75 USD por millón
**hasta el 31-dic-2026** (se duplica en 2027), Grok 4.6 2 / 6 (desde 200 mil tokens de entrada
4 / 12), Qwen 3.7 Flash 0.03 / 0.13 (desde 32 mil 0.10 / 0.40; desde 256 mil 0.20 / 0.80): el
tramo se elige por la entrada de cada llamada. GPT-6.1 Sol 2 / 10 (caché 0.10; desde 272 mil tokens de
entrada 4 / 15), Claude Sonnet 5.5 2 / 10 (como Sonnet 5) y Claude Opus 5.5 4 / 20 con lectura de caché
de 0.20 (el 5 %, no el 10 %; corregido el 29-sep-2026). El tope de respuesta del cerebro es de 4,096 tokens; si
una respuesta se corta o una acción llega incompleta, el vendedor ve el aviso 🤖 "respuesta
cortada" (nunca se descarta en silencio). Los model-id de API se verificaron contra docs
oficiales / OpenRouter (2026-09).

### Traspaso y respaldo entre modelos (27-sep-2026, decisión del dueño)

Diagnóstico del 27-sep en producción: "solo contesta Sonnet" era la pestaña con Interesado en el
Modelo 2 (el dueño ya la regresó al Modelo 1) y que Luna pasa al cliente a Interesado en su 1.ª
respuesta. Luna sí contestaba (44 de 60 respuestas del oficial) y cuesta ~25× menos por respuesta,
por eso el saldo de OpenAI casi no se movía. Regla del dueño: **Luna califica** (Inbox, Prospecto,
Interesado) y **Sonnet cierra** (Cerca de compra y Compra: datos bancarios, comprobantes, cierre).

- **Traspaso** (`handoffStage` en `lib/ai/runtime/model-by-stage.ts`): si el Modelo 1 contesta y
  con su respuesta el contacto pasa a una etapa del Modelo 2 —por `mover_etapa` o porque pidió el
  workflow `datos_bancarios` (el CRM lo mueve a Cerca de compra)—, aunque se salte etapas (Inbox →
  Compra), esa **misma** respuesta la escribe el Modelo 2. Recibe en el contexto del CRM «el contacto
  pasa a Cerca de compra: contesta como corresponde a esa etapa». La etapa que decidió el Modelo 1
  se aplica aunque el Modelo 2 no la pida. **Las acciones del Modelo 1 tampoco se pierden**
  (revisión completa, 27-sep-2026; `mergeHandoffToolCalls` en `lib/ai/runtime/tools.ts`): el
  workflow que provocó el traspaso (datos bancarios), sus avisos al vendedor y su Detalle salen aunque
  el Modelo 2 no los repita; si los repite, una sola vez. Su cotización no se arrastra (el cliente lee
  el texto del Modelo 2; un monto que ese texto no dice no se fija). Antes todo se descartaba y el
  cliente leía «te paso los datos» sin recibirlos. La llamada
  del Modelo 1 queda en `ai_usage` con resultado `traspaso` (se cobra, no se envía). Si el Modelo 2
  falla, sale la respuesta del Modelo 1.
- **Media tras una burbuja rechazada** (misma revisión): si la 1.ª burbuja sale y WhatsApp rechaza la
  2.ª, la media que pidió el modelo (tabla, video) se encola igual; antes se perdía y solo quedaba el
  aviso del texto omitido (`run.ts`, rama «salió una parte»).
- **Respaldo** (`brainCandidates`): si el modelo de la etapa falla (error del proveedor o respuesta
  sin texto ni acciones) contesta el otro, sin esperar. La tarjeta «El agente no pudo responder» sale
  solo si **fallan los dos**, y dice qué le pasó a cada uno. Un modelo sin llave se salta (en los
  dos sentidos). Con un solo modelo (el mismo en los dos espacios) sigue el reintento único por
  proveedor saturado de la Fase E. **Desde el 8-oct-2026 solo en las etapas del Modelo 2:** en una etapa del
  Modelo 1 el Modelo 2 nunca contesta por él (ver «Luna sin texto», abajo).
- **Red contra el silencio (30-sep-2026, dueño)** (`run.ts`, después del traspaso): el CRM **nunca** escribe
  un texto fijo por su cuenta. Antes, si el modelo contestaba solo con acciones (sin texto) y ninguna le
  mandaba algo al cliente, salía «Listo 👍 ¿En qué más te ayudo?» (o uno por motivo: comprobante, asesor,
  y el de la señal vieja «[TRANSFERIR]»). En producción salió 10 veces (27–29 sep) y ninguna era correcta:
  5 tapaban la pregunta de un workflow por palabra clave que ya había contestado, 3–4 dejaban una pregunta sin
  responder y 1 era un «gracias». Ahora, cuando la respuesta no le manda nada al cliente:
  1. si **ya le salió algo** después de su último mensaje (un workflow por palabra clave, aunque siga en
     camino), callar es correcto: no sale nada más (`sentToClientSinceLastInbound`, `context.ts`);
  2. si no, **escribe el otro modelo** (uno que no se haya usado ni fallado en esa ronda), con la nota «El
     cliente todavía no tiene respuesta a su último mensaje…» en el contexto del CRM. Las acciones de la
     primera respuesta (Detalle, avisos, workflows, etapa y el pase a humano) no se pierden. En una etapa del
     Modelo 1 no hay otro: le escribe otra vez el Modelo 1 con la misma nota (8-oct-2026). En el traspaso,
     si el Modelo 2 no escribe y nadie le ha contestado, sale lo que escribió el Modelo 1 (como si fallara);
  3. si **nadie escribe**, no sale nada y el vendedor recibe el aviso 🤖 `sin_respuesta` («El Agente IA no le
     escribió nada al cliente…»): tarjeta amarilla en el Embudo hasta que un vendedor conteste; **no** pausa
     al agente (la tarjeta roja de error sí lo haría).
  Una ronda sigue llamando al cerebro 2 veces como máximo (no se le vuelve a preguntar a un modelo ya usado).
  La primera respuesta queda en `ai_usage` con resultado `sin_texto` (se cobra, no se envía); el resultado
  final (`sent`) lo deja la que sí se usó, así el barrido no vuelve a intentar ese mensaje. Límites: si un
  workflow por palabra clave contesta una cosa y el cliente preguntó otra en el mismo mensaje, el paso 1 da
  todo por contestado; y un workflow pedido que al final no sale («Solo al inicio», máximo por chat) no se
  detecta aquí (hallazgo 1).
- Contactos de GHL que ya vienen en Cerca de compra o Compra los atiende Sonnet desde el primer
  mensaje (la etapa manda; el agente solo avanza etapas, nunca regresa).
- Tiempo: una ronda puede llamar al cerebro 2 veces; el candado de la corrida pasó de 6 a 8 min.
- `mover_etapa` dice ahora que puede saltarse etapas. El Goal de producción ya define cuándo se
  pasa a cada etapa (sección ETAPAS DEL EMBUDO); no se tocó.
