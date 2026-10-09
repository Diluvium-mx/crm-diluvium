> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## El texto del Agente IA va como pie del archivo (1-oct-2026, sin migración)

Caso del dueño (1-oct, captura): el cliente pidió el video de instalación; el Agente IA escribió «Claro, aquí comparto el
video de instalación de la mini compuerta.» y después salió el video con el pie del workflow «Aquí le comparto un video de
la instalación de las mini compuertas»: lo mismo dos veces. Pedido del dueño: que el Agente IA lo mande como texto
adjunto al video y ya.

- **Cuándo:** el agente pide un workflow como herramienta y su **primera** corrida **solo manda archivos** (un video, la
  Tabla) y **no** tiene «El workflow es la respuesta» (con la casilla aplicaba hasta el 8-oct-2026; desde el 9-oct sale
  el pie del workflow: ver la sección siguiente). Su texto (si eran dos mensajes, juntos con un renglón en blanco) va
  como **pie del primer archivo**, en lugar del pie del workflow: **un solo mensaje**. Los demás archivos conservan su
  pie. Las **esperas antes de ese archivo no corren** (la Tabla espera 18 s: era para que el cliente leyera primero la
  frase, que ahora va con la imagen; así la respuesta no se retrasa). Por palabra clave, comando o etapa el workflow sale
  como siempre, con su pie y sus esperas.
- **No aplica** (el texto sale aparte, como antes, y luego la corrida): el workflow trae textos (si es «la respuesta»,
  el texto del modelo no sale, «Depende»), el texto no cabe en el pie (1,024 caracteres de WhatsApp) o la corrida no
  arranca (máximo por chat, «Solo al inicio», canal apagado…).
- **Cómo:** `run.ts` (`captionRunOf` en actions.ts, `takesAgentCaption` en lib/workflows/steps.ts) revisa el estado
  como antes del primer mensaje (vendedor, pausa, cliente que escribió: entonces se vuelve a generar con todo) y arranca
  esa corrida con el texto en `workflow_runs.payload.pieDelAgente` (durable entre reintentos; no es una variable
  {{…}}). El resto de las corridas sale después, en el mismo orden. En `ai_usage.error`: «el texto va como pie del
  archivo de «slug»». La respuesta cuenta 0 mensajes enviados: el total de un vendedor no se reemplaza con uno que el
  cliente aún no recibió.
- **Ejecutor:** el archivo sale con el texto del agente como pie y la marca `respondeHasta` (es la respuesta del agente,
  no «relleno» de workflow: cierra lo que el agente leyó y nada de lo que el cliente escribió después). Si la corrida ya
  no sale al arrancar (la deshabilitaron, otra corrida llegó al máximo, ya no es el inicio), el texto sale **solo** con
  la misma marca (en el peor caso queda como antes: la frase sin el archivo); si el agente ya no puede actuar (un
  vendedor contestó, lo pausaron) no sale nada. Si mientras esperaba le agregaron textos al workflow, el texto sale
  antes del primer paso. Si el archivo falla (ventana cerrada, rechazo), el aviso 🤖 lleva el texto que iba con él.
