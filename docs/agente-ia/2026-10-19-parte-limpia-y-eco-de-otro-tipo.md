> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Parte limpia y eco de otro tipo (19-oct-2026, sin migración)

**Origen:** revisión en producción del vie 16-oct 12:00 al lun 19-oct 08:00 (Mazatlán). De 571 respuestas, 7 clientes
se quedaron sin respuesta con el Agente IA activo. Dos causas se arreglan aquí (A y B; OK del dueño, 19-oct).

### A. Parte limpia: el texto bueno que iba antes del texto interno

- **Qué pasó:** el cliente contesta «Sí» a «¿Usted tiene problemas de inundaciones?» (último paso de «Información») y
  GPT-5.6 Luna escribe «¿Hasta qué altura aproximada le sube el agua?» seguido de su llamada a `actualizar_detalle` como
  texto (JSON, «[tool calls] multi_tool_use.parallel…», «[Need tool calls after text]»). Del 10 al 19-oct pasó 16 veces;
  el reintento del 10-oct ([texto interno](2026-10-10-texto-interno-reintento.md)) salvó 13. En 3 la segunda respuesta
  también falló: chat de Samuel y Rocío (otra vez texto interno → tarjeta y pausa) y chat 😋 de Coatzacoalcos (solo
  acciones → aviso «sin respuesta»). En los dos la pregunta de arriba era correcta.
- **Cambio** (`internal-text.ts` › `cleanBeforeInternal`, `run.ts` › `attempt`): el reintento sigue igual y va primero.
  Si el reintento TAMBIÉN trae texto interno, o sale sin texto, sale el texto bueno que iba ANTES de lo interno (el del
  reintento o, si no tiene, el de la primera respuesta), con las acciones válidas del reintento. Se quitan los renglones
  de adorno del final («━━━━», «---»).
- **No aplica (todo sigue como antes: tarjeta o red contra el silencio):** lo interno va en el primer renglón; lo interno
  nombra un workflow (`wf_…`, el texto pudo prometer un archivo que no saldría); el reintento en blanco ante un acuse
  («ok gracias») o en el complemento de un workflow (callar es lo correcto).
- **Registro:** la fila `sent` de `ai_usage` dice «parte limpia: el reintento también traía texto interno o no
  escribió…». Costo: cero (sin llamadas extra).

### B. Eco de otro tipo: el envío que sí llegó ya no pausa al Agente IA

- **Qué pasó:** Zernio no contestó el POST a tiempo (15 s) pero sí mandó el mensaje. El eco no se unía porque llegó con
  otro tipo: el seguimiento (plantilla) volvió como texto (chat de Silvia) y, en Instagram, el video con pie volvió como
  dos ecos, texto + video (chat de Ary Prat, Chile). A los 15 min el envío se dio por «no confirmado», tarjeta y Agente IA
  en pausa: Silvia contestó «Estoy viendo opciones» y Ary «Soy de chile» y nadie les respondió. 10 envíos así del 10 al
  19-oct.
- **Cambio** (`lib/messaging/late-echo.ts`, `docs/bandeja.md` › Timeout de Zernio y su eco): además de mismo tipo y
  texto, se une (1) una plantilla con su eco «text» del mismo texto; (2) en Instagram, un archivo con pie con el eco
  «text» del pie o con el eco del archivo sin texto; el segundo eco queda como parte del mismo envío
  (`partesInstagram`). Si hay un texto en duda con el mismo texto, gana el del mismo tipo. Vale para el eco tardío y
  para el temprano. Misma conversación y ventana de 2 h, como siempre.

**Vigilar en prod:** filas de `ai_usage` con «parte limpia» (que el texto que salió tenga sentido) y tarjetas
`agente_error` «no confirmó» con un eco «otra API» al lado.
