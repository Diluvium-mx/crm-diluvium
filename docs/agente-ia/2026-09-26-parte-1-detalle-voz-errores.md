> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Parte 1 (26-sep-2026): Detalle automático, notas de voz y errores de envío

Rama `feat/agente-parte-1`, migración **`0037_agente_parte_1`** (etapa `transcripcion` en `ai_usage`,
`messages.transcripcion`, `ai_agent_drafts.runs`, borra `ai_config.daily_budget_usd` y crea el usuario de
sistema "Agente IA"). El Goal y las FAQs no se tocaron.

### A. Autollenado del Detalle del contacto (`actualizar_detalle`)
- Acción interna nueva en la **misma llamada** que la respuesta (sin llamada extra), junto a
  `fijar_cotizacion`, `mover_etapa` y `aviso_vendedor`: inundaciones (si/no/no_sabe), nivel del agua en cm
  y en texto, número de entradas, un ancho por entrada (el tamaño sugerido lo calcula `suggestSize`), % de
  convencimiento (0–100 de 10 en 10, como el selector) y un comentario. El monto sigue con `fijar_cotizacion`.
- Instrucción mínima solo en la descripción de la acción: llenar solo con lo que dijo el cliente, sin
  adivinar, actualizar el % conforme avance, y ir **después** de la respuesta escrita (sin esa frase, Sonnet 5
  contestó SOLO con acciones en 2 de 19 pruebas: el cliente habría recibido el texto de respaldo en vez de
  su respuesta; con ella, 0 de 30. Desde el 30-sep-2026 ya no hay texto de respaldo: red contra el silencio).
- Escribe con `lib/contacts/qualification.ts` (`updateContactQualification`, `setNumEntradas`,
  `updateEntrada`, `addComment`) dentro de una transacción con la fila del contacto bloqueada
  (`lib/ai/runtime/detalle.ts`). Validación campo por campo: un dato raro se descarta sin tirar los demás y
  sin avisar al vendedor.
- **Regla del dueño (cambiada el 26-sep por la tarde, tras probarlo desde el celular): ningún dato es
  definitivo, ni para el vendedor ni para el agente.** El agente sigue leyendo toda la conversación y, si un
  dato guardado ya no cuadra con lo que dijo el cliente (p. ej. al final son 2 compuertas y no 1), lo
  corrige; una edición del vendedor es "una acción más". Vale también para el **monto** (el total que el
  agente le dice al cliente corrige el de un vendedor). La **etapa** sigue igual (solo hacia adelante; la de
  un vendedor se respeta). El origen por campo en `contacts.custom_fields.detalle_por`
  (`{ campo: "agente" | "vendedor" }`, sin migración) solo dice quién escribió al último: pinta la marca
  "IA" y el contexto del modelo avisa "(lo corrigió un vendedor)" (pudo saberlo por teléfono). Llaves:
  `tiene_inundaciones`, `nivel_agua_cm`, `nivel_agua_texto`, `num_entradas`, `porcentaje_convencimiento`,
  `entrada_<n>_ancho` (`_linea`, `_tamano` solo los escribe el vendedor).
- Comentarios firmados por el usuario de sistema **"Agente IA"** (`usuario-sistema-agente-ia`, como
  "Importado": no inicia sesión ni es miembro; desde el cambio de roles del 26-sep, cualquier rol que edite
  contactos puede editarlos o borrarlos). No repite uno ya
  guardado (igual sin acentos ni mayúsculas); máximo 2 por respuesta.
- El contexto del CRM del último turno trae el Detalle guardado y **solo los comentarios del propio agente**
  (las notas internas de los vendedores no van al modelo: podría repetírselas al cliente).
- **Detalle del contacto (rediseño del 26-sep, pedido del dueño; Bandeja y pop-up del Embudo, mismo
  componente):** secciones Calificación · Agente IA · Comentarios; marca **"IA"** a la derecha de cada
  campo que el agente escribió al último (Etapa, inundaciones, agua, entradas y anchos, monto, %); si un
  vendedor lo edita se va, y si el agente lo vuelve a corregir regresa. El campo que el agente acaba de
  llenar se ilumina ~2.4 s y su marca muestra el orbe del chat con "IA actualizando" (sin animación con
  "reducir movimiento"). El **% de convencimiento** es de solo lectura (barra + número): lo decide el agente.
- **Control del agente:** vive SOLO en el Detalle (se quitó "Apagar bot" del encabezado del chat). Una sola
  fila, la de la conversación abierta (un contacto con chat en dos canales —sandbox y número de prueba—
  mostraba dos): "🟢 Activo · [Pausar agente]" (8/12/24 h, fecha y hora o **Pausar indefinidamente**) o
  "🟠 Pausado indefinidamente / Pausado · vuelve hoy 22:30 · [Activar]". El aviso del hilo solo informa
  ("se activa en el Detalle del contacto").
- **Costo medido** (26-sep, conversación de prueba con una nota de voz de medidas, Goal de
  `docs/agente-ia/angela-goal.md` + bloque §10.5 + 47 FAQs + 6 workflows; caché caliente, promedio por
  respuesta): **Luna (Modelo 1)** sin la acción US$0.00065 → con ella US$0.00064–0.0009 (+~300 tokens de
  entrada, casi todos en caché); **Sonnet 5 (Modelo 2)** US$0.0146 → US$0.0159 (**+US$0.0013, ~9 %**;
  +652 tokens de entrada en caché y ~110 de salida). La primera llamada de cada conversación escribe la
  caché una vez (igual que antes).
- **Con "Cambios en vivo"** (entró a main antes, 6e677fd; esta rama se rebasó encima): un solo parámetro
  `by: ContactActor` en `qualification.ts`; el origen se deriva de él (vendedor → `"vendedor"`, Agente IA →
  `"agente"`, automatización → sin marca). El comentario del usuario de sistema avisa como del agente. El
  Detalle abierto relee también `iaFields`: probado en el navegador, los 7 campos y sus marcas "IA"
  aparecen solos, sin refrescar.

### B. Notas de voz
- Modelo: **`gpt-4o-mini-transcribe`** (OpenAI, llave `OPENAI_API_KEY` que ya existía): **US$0.003 por
  minuto** (estimado oficial; gpt-transcribe cuesta 0.0045 y gpt-4o-transcribe/Whisper 0.006). Fuente:
  https://developers.openai.com/api/docs/pricing (consultada el 26-sep-2026). Prueba real: nota de voz de
  19 s en OGG/Opus (como WhatsApp) → texto exacto con "2.40" y "95 centímetros", ~1–2 s, US$0.00094.
- El worker la transcribe en cuanto el audio está en el bucket (`lib/ai/transcription/`): solo entrantes del
  cliente de la última hora (nunca el historial viejo ni el importado del celular), tope de **10 minutos**
  (la duración se lee del archivo: `lib/audio/duration.ts`), reclamo atómico (un solo cobro aunque haya
  reintentos) y costo por minuto en `ai_usage` (etapa `transcripcion`, sale en el Gasto de IA de OpenAI).
- Texto en `messages.transcripcion`; estado del intento en `messages.metadata.transcripcion`
  (pendiente | lista | fallida | omitida). El chat muestra **"Transcripción"** debajo del audio (o
  "Transcribiendo…" / "Sin transcripción: motivo") en la Bandeja y el pop-up del Embudo, en vivo.
- El agente lee `[nota de voz] texto`; la espera de 15 s aguarda la transcripción **hasta 60 s** desde que
  llegó el audio (el worker la adelanta al terminar). Si falla o tarda más: `[nota de voz sin transcribir]`.

### C. Error de envío (reenvío del MISMO texto)
- Causa del diagnóstico de Anuncios: el rechazo real de Zernio llega como `ZernioSendError` y
  `classifySendError` lo buscaba por nombre (`SendFailedError`): quedaba sin clasificar, el job se relanzaba
  y la cola generaba hasta 3 respuestas distintas con gasto. Ahora se clasifica por forma.
- Toda respuesta se guarda como plan antes del 1er mensaje, con **ids de mensaje deterministas** por
  burbuja (fila de `messages` = Idempotency-Key de Zernio). **Cualquier** falla del primer mensaje (CRM,
  Zernio, error raro, la BD) deja el plan `pendiente` y la misma tarjeta "Reintentar / Apagar"; ni la cola
  ni el barrido vuelven a llamar al modelo. "Reintentar" reenvía el MISMO texto con la MISMA clave
  (`sendAgentText`): lo que ya salió no se repite; lo que Zernio aceptó pero el CRM no alcanzó a enlazar
  lo devuelve la clave sin mandarlo dos veces; un resultado ambiguo (5xx/timeout) no se reenvía. Después
  corre la media que iba tras el texto y atiende lo que el cliente escribió mientras tanto (eso sí es otra
  llamada: son mensajes nuevos). "Apagar", "Reactivar" o una respuesta del vendedor la descartan.
- Probado con un error simulado de cada tipo (`run.int.test.ts`, bloque "C ·"): rechazo del CRM (ventana
  cerrada), rechazo de Zernio (400), error no clasificado después de que Zernio aceptó, fila sin enlazar,
  resultado ambiguo (503), reintento que vuelve a fallar, "Apagar" y respuesta vieja tras "Reactivar".

### D. Limpieza
`ai_config.daily_budget_usd` borrada en la 0037 (no la leía ningún código).

### Gate (26-sep-2026)
- `npm run typecheck | test | lint` en verde (1,075 pruebas + 5 omitidas, con la base de pruebas).
- **cyber-neo** (solo el delta): 0 hallazgos reales, 4 informativos (llave falsa en una prueba, audio a
  OpenAI, inyección por voz hacia comentarios firmados "Agente IA", costo de transcripción sin tope por
  conversación).
- **Codex** (`adversarial-review --base origin/main`) y una **revisión independiente de Claude**: corregido
  con prueba (1) un plan rechazado cuyo worker se reinició antes de la tarjeta ya no queda "enviado": queda
  guardado con su tarjeta; (2) un "Reintentar" cuya corrida se pierde en Redis lo re-programa el barrido;
  (3) una fila en cola de más de 15 min ya no se reenvía (pudo salir; la clave de Zernio vence a las 24 h);
  (4) una transcripción que ya llamó a OpenAI no se vuelve a pagar; (5) lo que el cliente escribe mientras
  espera la tarjeta sigue pendiente en la BD tras el reenvío (`metadata.respondeHasta`); (6) un envío sin
  confirmar ya no da una tarjeta "Reintentar" sin salida (aviso para revisar el celular); (7) una respuesta
  guardada de más de 24 h o con la ventana cerrada se descarta con aviso.
- **Aceptado (instrucción del dueño: borrar la columna en la 0037):** entre el pre-deploy y el cambio de
  contenedor (~1–2 min), la pestaña Agente IA del web anterior falla al abrir o guardar (`select()` de
  `ai_config` con la columna ya borrada). El worker y los clientes no se afectan. Si el despliegue nuevo
  fallara después de migrar, esa pestaña queda así hasta el siguiente despliegue.

### Teóricos (sin escenario real hoy; no abren ronda)
- `updateEntrada` escribe `linea`/`ancho` desde una lectura previa: un cambio de línea del vendedor en el
  mismo milisegundo que el agente llena el ancho de ESA entrada podría revertirse.
- Un vendedor tecleando un ancho mientras el agente baja el número de entradas ve un error al guardar esa fila.
- `detalle_por` corrupto (no objeto) perdería las marcas; hoy solo lo escribe este código.
- Las marcas por posición sobreviven al borrar filas (una fila recreada vacía puede mostrar "IA"; una
  posición "vendedor" queda vetada al agente).
- "¿Cuánta agua entra?" conserva la marca si el vendedor solo edita los cm (el texto sigue del agente).
- Campos que se vaciaron antes de esta función no tienen origen: el agente los puede llenar.
- Modelo que conteste SOLO con `actualizar_detalle`: lo resuelve la red contra el silencio (otro modelo
  escribe o aviso `sin_respuesta`; medido 0 de 30 con la descripción actual).
- `nivel_agua_texto` escrito por un vendedor llega al contexto del modelo (es un campo del Detalle, no nota).
- Si la BD cae justo en `holdForRetry`, el plan queda "enviando" y a los 10 min el barrido podría volver a
  atender el entrante con el modelo (doble falla).
- Un OGG manipulado (página dañada) se mediría más corto que su duración real (tope de 25 MB igual).
- Un reinicio entre `savePlan` y el primer envío bloquea al agente en esa conversación hasta 10 min.
- `ALTER TABLE messages ADD COLUMN` pide un candado exclusivo breve; si coincide con el respaldo diario, el
  pre-deploy falla por `lock_timeout` (5 s) sin tumbar nada y se reintenta.
- Un spammer con muchas notas de voz largas: ~US$0.03 por audio, visible en el Gasto de IA.
