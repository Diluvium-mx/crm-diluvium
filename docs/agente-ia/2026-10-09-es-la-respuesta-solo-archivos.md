> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Workflow «es la respuesta» de solo archivos pedido por el Agente IA (9-oct-2026, sin migración)

Caso del dueño (8-oct, captura): activó «Dónde medir la entrada» con su pie («Le comparto un video de como debe medir su
entrada☝🏻») y con «El workflow es la respuesta» marcada. El Agente IA lo mandó con **su** frase de cuatro renglones como
pie (regla del 1-oct), no con la del dueño. Decisión del dueño: usar la casilla actual (opción 1B; la Tabla también la
tiene y el cambio le aplica, aceptado) y que el Agente IA conteste aparte lo que el cliente haya preguntado además
(opción 2A, complemento, como por palabra clave).

- **Texto del modelo:** con un workflow marcado que solo manda archivos, su texto **no sale** (igual que con textos,
  «Depende»): `answerRunsOf` (actions.ts) distinguía `textos` y `archivos` (desde el cambio de textos del mismo día ya no
  hace falta: ver la sección siguiente). La corrida arranca **sin** `pieDelAgente`: el
  archivo lleva el pie del workflow y **sus esperas corren** (la Tabla: 18 s antes de la imagen, con su pie fijo).
- **Ejecutor:** el archivo contesta **solo el mensaje que lo disparó** y pide la revisión del agente (`markAnswersOnly`
  con `contestaA` + `revisaAgente`) y además guarda **`revisaDesde`** (hora UTC en que salió). La respuesta que pidió el
  workflow ya dejó su resultado en `ai_usage` **antes**; sin esa hora contaría como la revisión y no habría complemento.
  `answeredOnlySql` (pendientes) y el barrido (también la alarma «bot callado») solo cuentan un resultado **posterior** a
  `revisaDesde`. Las marcas sin `revisaDesde` (palabra clave) siguen igual.
- **Agente:** la corrida que pidió el workflow termina con `reschedule` (`complemento_workflow_respuesta`, 5 s). Mientras
  el archivo va en camino espera (`answerRunInFlight`); el candado «ya atendido» no corta mientras la corrida va en camino
  o el archivo espera su revisión (`awaitingWorkflowReview`). Luego entra en **modo complemento** (`complementNote`): si el
  cliente preguntó algo más («¿Dónde mido y cuánto cuesta?») contesta solo eso, **sin preguntas**; si no, `[NADA_QUE_AGREGAR]`.
  Si el cliente escribió mientras tanto, contesta todo junto como siempre (`partialNote`).
- **Sin repetir el archivo:** si en la revisión el modelo vuelve a pedir el mismo workflow, no sale otra vez
  (`prepareActions` ahora descarta también las corridas del propio agente para esos mensajes, no solo las de palabra
  clave; nota solo en el log: «ya salió para este mensaje»).
- **Si el workflow no arranca:** como con textos, aviso 🤖 al vendedor con el texto que no salió (el cliente no queda
  esperando un complemento).
- **Corridas encoladas antes del cambio** con `pieDelAgente`: salen como antes (pie del agente, `respondeHasta`, sin
  revisión).
- **Costo:** una llamada más al modelo por cada envío así (Dónde medir: 1 corrida en 7 días al 8-oct; la Tabla por el
  agente, unas pocas al día). Carrera conocida: si el archivo saliera antes de que se guarde el registro de la respuesta
  que lo pidió (no pasa en la práctica: la marca se pone después de que Zernio contesta), no hay complemento; el mensaje
  queda contestado por el archivo, sin duplicar nada.
- Pruebas: `run.int.test.ts` (Dónde medir completo, dos preguntas, ráfaga, no arranca, la Tabla con su espera) y
  `executor.int.test.ts` (marca con hora; corrida vieja con `pieDelAgente`).
