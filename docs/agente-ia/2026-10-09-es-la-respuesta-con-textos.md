> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Workflow «es la respuesta» con textos pedido por el Agente IA (9-oct-2026, sin migración)

Caso del dueño (9-oct): creó en producción «Entrada mayor a 2.5 m» (paso 1: foto del poste con el pie «La compuerta más
amplia que fabricamos es de 2.5 m. Para entradas más anchas no recomendamos cubrir todo el ancho, porque es más
probable que haya filtraciones.»; paso 2: texto «Aun así, se puede colocar un soporte intermedio como el de la foto: un
poste de acero anclado al piso entre dos compuertas, que tendría que fabricar un herrero de su confianza (nosotros no lo
fabricamos ni lo vendemos). ¿Le gustaría protegerla de esta forma?»; sin espera, «El workflow es la respuesta», máximo 2
por chat, lo dispara el Agente IA) y borró el predeterminado viejo «Medidas especiales (más de 250 cm)». Con textos, el
último mensaje del workflow contestaba **todo** lo que el agente leyó (`respondeHasta`) y no había complemento: con «Son
4.2 m. ¿Hacen envíos a Culiacán?» lo del envío se perdía. Decisión del dueño: que con textos sea **justo como «Dónde
medir»** (sección anterior).

- **Ejecutor** (`lib/workflows/executor.ts`): toda corrida del Agente IA de un workflow «es la respuesta» (sin
  `pieDelAgente`) marca su último mensaje con `markAnswersOnly` y revisión (`contestaA` + `revisaAgente` + `revisaDesde`),
  traiga textos o archivos. Antes, con textos, `markAnswersUntil` (`respondeHasta`). `respondeHasta` solo queda para una
  corrida vieja con `pieDelAgente` cuyo workflow, mientras esperaba, ahora trae textos (su texto ya salió solo antes del
  primer paso). Foto y texto salen seguidos, sin esperas (el workflow no tiene).
- **Agente** (`lib/ai/runtime/run.ts`): la corrida que pidió el workflow termina con `reschedule`
  (`complemento_workflow_respuesta`) también con textos; `answerRunsOf` (actions.ts) ya no distingue textos y archivos
  (devuelve los workflows marcados que mandan algo). Mientras el workflow va en camino espera (`answerRunInFlight`);
  `awaitingWorkflowReview` (context.ts) ya no excluye los workflows con textos: sin eso, el sondeo de los 5 s cortaba con
  «ya atendido» y el complemento esperaba al barrido (~90 s). Luego entra en **modo complemento** (`complementNote`):
  contesta solo lo que el cliente preguntó aparte («Sí, enviamos a Culiacán…»), **sin preguntas** (la del workflow sigue
  siendo la última), o `[NADA_QUE_AGREGAR]`. Si el cliente escribió mientras salía el workflow, contesta todo junto como
  siempre (`partialNote`). Si en la revisión el modelo vuelve a pedir el workflow, no sale otra vez.
- **Nota del complemento** (`lib/ai/runtime/complement.ts`): además de ciudad, envíos, instalación, garantía y formas
  de pago, nombra «otra entrada con su propia medida» y, como tema de un workflow, «una entrada más ancha de lo que
  fabricamos» («Tengo dos entradas: la puerta de 1.10 y la cochera de 5 metros» → el workflow contesta la cochera y el
  agente, la puerta de 1.10 m). La misma nota sirve a los complementos por palabra clave; va en el contexto del último
  turno (no toca el Goal, las FAQs ni la caché).
- **Predeterminados:** `medidas_especiales` («Medidas especiales (más de 250 cm)», comando `/especial`, texto viejo de la
  fabricación especial de 280 cm) sale de `DEFAULT_WORKFLOWS` (`lib/workflows/defaults.ts`): «Restaurar
  predeterminados» y una organización nueva ya no lo crean.
- **Qué cambia en producción:** hoy el único workflow con textos + «es la respuesta» + Agente IA es «Entrada mayor a
  2.5 m». «Tapones inflables» tiene textos y Agente IA pero no es la respuesta: no cambia. Por palabra clave, comando o
  etapa, nada cambia.
- **Costo:** una llamada más al modelo por cada envío así (como «Dónde medir»).
- **Hueco conocido (ya existía con «Dónde medir» y por palabra clave):** en una ráfaga («Hola» + «Son 4.2 m de ancho»)
  el workflow contesta el último mensaje; si el complemento contesta algo, cierra los dos, pero si decide
  `[NADA_QUE_AGREGAR]` el primero sigue pendiente y el barrido se lo vuelve a dar al agente (normal, sin la nota del
  complemento). Antes, con textos, `respondeHasta` cerraba los dos.
- Pruebas: `run.int.test.ts` («Precio 2» como herramienta, ahora con complemento; «Entrada mayor a 2.5 m»: nada que
  agregar y luego «Sí, me interesa», otra pregunta, dos entradas, el cliente escribe mientras sale, ráfaga),
  `executor.int.test.ts` (marca con hora para foto + texto; corrida vieja con `pieDelAgente` que ahora trae textos) y
  `defaults.test.ts` (sin `medidas_especiales`).
