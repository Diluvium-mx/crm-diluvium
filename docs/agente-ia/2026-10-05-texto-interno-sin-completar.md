> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Texto interno y respuestas sin completar: no sale nada, tarjeta y pausa (5-oct-2026, sin migración)

- **Qué pasó (30-sep → 4-oct):** 6 mensajes llegaron a 5 clientes con lo que el modelo «pensaba hacer» en vez de
  hacerlo: `[tool call] wf_video… actualizar_detalle {…}`, `[We need tool after response]`, `[tool call?]`, `[actions]` y
  `*(sin acción adicional, la respuesta ya fue enviada por el sistema)*` (5 de Luna, 1 de Sonnet). Siempre DESPUÉS de
  una respuesta buena, aparte o en su último renglón. Causa: el sufijo del CRM decía «primero tu texto para el cliente
  y luego la llamada» y algunos modelos escribían la llamada.
- **Capa 1, la causa** (`brain.ts`, sufijo): «Las acciones se piden SOLO llamando su herramienta… El cliente recibe TODO
  lo que escribas: nunca escribas el nombre de una herramienta o acción, sus datos, JSON, corchetes ni notas». Cambia el
  prefijo en caché una vez (una escritura de 1 h, centavos).
- **Capa 2, candado antes de enviar** (`internal-text.ts` › `unfinishedReply`, en `run.ts` después de las revisiones de
  frescura y ANTES de cualquier acción): renglón por renglón, 6 patrones (mensaje entre corchetes, «tool call»,
  nombres de acciones, JSON, nota entre paréntesis, notas al sistema). Probado contra los 4,825 renglones que el Agente
  IA mandó en producción (26-sep → 5-oct): marca los 6 y ninguno bueno. También detienen la respuesta: el corte por
  el tope de tokens y una acción pedida que no se puede hacer (datos inválidos, herramienta que no existe; el Detalle
  sin datos válidos no cuenta). Resultado: **no sale nada, no se ejecuta nada**, tarjeta `agente_error` y el Agente IA
  queda en pausa en ese chat (`hasUnresolvedAgentError`) hasta que un vendedor elija Reintentar (otra llamada al
  modelo) o Apagar. Sin respuesta de respaldo del otro modelo (decisión del dueño). `ai_usage`: outcome `error`,
  `no salió: …`. Costo y tiempo: cero (expresiones regulares sobre el texto, sin llamada extra).
- **Capa 3, último candado** (`send.ts` › `sendAgentText`): todo texto del Agente IA pasa por ahí (respuesta,
  Reintentar, lo que venga); un texto interno lanza `SendRejectedError("not_retryable")` y nunca sale.
- **Lo que no se completó DESPUÉS de enviar** (`agent-error.ts` › `holdAgentForReview`): WhatsApp rechazó o no confirmó
  un mensaje del Agente IA (barrido), salió solo una parte, un workflow que pidió el Agente IA no se envió (`executor.ts`,
  trigger `agent`), un workflow «es la respuesta» que no arrancó o las acciones fallaron → antes era un aviso 🤖 y el
  Agente IA seguía; ahora es la misma tarjeta y el Agente IA queda en pausa en el chat. Un workflow por palabra clave
  sigue con su aviso. El barrido no agrega otra tarjeta si el chat ya tiene una abierta.
- **Siguen como aviso, sin pausa:** `fijar_cotizacion` rechazada porque el total no se le dijo al cliente (es la
  protección, no una falla; 0 desde el 2-oct), un workflow omitido por «Solo al inicio» o «Máximo por chat» y la
  respuesta guardada que venció (24 h o ventana cerrada).
- **Letras de otro alfabeto: se borran, sin pausa (6-oct-2026, sin migración; decisión del dueño).** A una clienta en
  Prospecto le llegó «娱乐平台招商» como burbuja aparte detrás de una pregunta buena, y el 2-oct a otro cliente «屹»
  solo (2 de 5,318 salientes, las dos de GPT-5.6 Luna). Revisado en prod: el Goal (y todo su historial), las FAQs,
  los Mensajes rápidos y los workflows no tienen ni un carácter así; es basura del modelo. El dueño pidió que NO se
  detenga la respuesta ni se pause al Agente IA. `internal-text.ts` › `stripForeignScript` borra toda letra que no sea
  del alfabeto latino (chino, japonés, coreano, cirílico, árabe…) y el renglón que se queda vacío; el resto queda
  idéntico (acentos, ñ, ü, º/ª, °, m² y emojis pasan). Dónde:
  1. `run.ts` › `attempt`, al leer la respuesta del modelo: sale lo demás (caso 6-oct: sale solo la pregunta). Si no
     queda texto ni acciones (caso 2-oct), se le pide otra respuesta al mismo modelo UNA vez (fila `ai_usage` con
     «solo letras de otro alfabeto; se pide otra respuesta»); si tampoco, es respuesta vacía y contesta el otro modelo
     (en una etapa del Modelo 1, desde el 8-oct, otra vez el Modelo 1 y luego la tarjeta).
  2. Puerta común (`send.ts` › `sendTextMessage` y el pie de `sendMediaMessage`): a todo lo que sale con
     `source = ai_agent` (textos sueltos de workflows, pies, seguimientos) se le borran también; solo si no queda nada,
     no sale (`not_retryable`). Lo que escribe un vendedor no se toca.
  3. Borrador de seguimiento con otro alfabeto: se rehace una vez (`borrador-check.ts`).
