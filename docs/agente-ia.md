# Agente IA — Fase A (Fundación del modelo)

Primer paso del Agente IA (replicar/mejorar a "Ángela" de GHL). Esta fase deja el
**mecanismo del modelo listo y seleccionable**; el agente **todavía no responde a
clientes** (eso llega en la Fase B y siguientes).

## Qué hay

- **Capa multi-proveedor** (`lib/ai/`, compartida web + worker): una función
  única `callModel(modelId, { system, messages, tools? })` → texto + uso de
  tokens normalizado. Las llamadas van **directo al proveedor** con su llave (sin
  gateway de terceros).
  - `catalog.ts`: registro de modelos (id, proveedor, model-id de API, nivel,
    multimodal, rol). **Fuente única**; agregar un modelo = una entrada aquí.
  - `provider.ts`: metadatos de proveedor + disponibilidad (`modelAvailability`).
  - `providers/{openai,anthropic,google,xai,openrouter}.ts`: adaptadores (Google, xAI y
    OpenRouter desde la Fase E, 25-sep-2026; OpenRouter con el paquete oficial
    `@ai-sdk/openai-compatible`). Agregar un proveedor = **un archivo adaptador nuevo +
    registrarlo**; nada más cambia.
- **Caché del system por proveedor**: OpenAI automática (prompts ≥1024 tokens);
  Anthropic explícita con `cacheControl: { type: 'ephemeral' }` en el bloque de
  sistema. Se reporta en `usage.inputTokenDetails.cacheReadTokens` /
  `cacheWriteTokens`. Con el system de prueba (corto) marca 0 hasta que el system
  real (largo) llegue en la Fase B; el cableado y el reporte ya están listos.
- **`ai_config`** (una fila por organización): `modelo_filtro`, `modelo_cerebro` (= Modelo 2
  desde la Fase E), `modelo_1` y `etapas_modelo_1` (migración 0033). Default filtro = Luna,
  Modelo 1 = Luna para Inbox, Prospecto e Interesado, Modelo 2 = Sonnet 5 para el resto. Editable solo
  owner/admin (ACL: recurso `aiConfig` en `lib/auth/permissions.ts`).
- **Pestaña "Agente IA"** (`/agente-ia`, solo owner/admin) — desde el 24-sep-2026 es el
  **editor estilo GHL** (solo personaliza al agente):
  - Encabezado con el **nombre del agente** editable con lápiz (`ai_config.agent_name`).
  - Desde el 27-sep-2026 va en **subpestañas fijas** arriba (`?seccion=`): Modelos ·
    Instrucciones (Goal) · FAQs · Opciones · Tallas y medidas · Canales · **Historial** (antes
    «Crear | Implementar»). **Todo cambio pide confirmación** en el pop-up de arriba (etapas, nombre del
    agente, Goal, FAQs, versiones, Opciones, Tallas y Canales); cada versión del Goal y de las
    FAQs se puede **nombrar con el lápiz ✎** (`ai_knowledge_versions.name`, migración 0040) y
    Opciones se guarda con un solo **«Guardar cambios»** que lista «antes → después».
  - **Modelos** (Fase E, 25-sep-2026): selector del **Modelo 1** (recomendado
    Luna) y del **Modelo 2** (recomendado Sonnet 5), cada opción con su costo aproximado por
    cada 100 conversaciones, el **logo de la marca del modelo** a la derecha (desde el 28-sep-2026;
    SVG en `public/logos-ia/`, mapa en `lib/ai/logos.ts`, campo `logo` del catálogo; al pasar el
    mouse se mueve con un movimiento sorteado por visita, `lib/ai/logo-motions.ts`) y en gris si
    falta su llave, y **qué modelo atiende cada etapa**
    del Embudo ("Modelo 1 | Modelo 2" por etapa; se usa la etapa del contacto al responder).
    La sección **Empresa** se quitó el 25-sep (el Goal ya dice quién es la empresa;
    `{{empresa.nombre}}` sale de `ai_config.company_name` o, si no hay, del nombre de la
    organización). Editor grande del **Goal** con
    deshacer, contador de palabras y tokens aproximados (el botón **Valores personalizados**
    se quitó el 28-sep-2026, decisión del dueño: el Goal escribe "Angela" y "Diluvium" tal
    cual; `{{contacto.nombre}}`, `{{vendedor.nombre}}`, `{{empresa.nombre}}` y
    `{{agente.nombre}}` escritos a mano los sigue sustituyendo el runtime);
    **base de conocimiento** (FAQs: agregar, editar, activar/desactivar, borrar). Cada
    guardado del Goal o cambio de FAQs deja una **versión** (`ai_knowledge_versions`) y se
    puede **restaurar** cualquiera (la primera vez guarda también la anterior). Desde el
    28-sep-2026 (pedido del dueño, para revisarlas afuera): **Copiar** arriba a la derecha del
    Goal (todo el texto del editor, con lo no guardado) y de las FAQs (todas, sin importar
    búsqueda ni filtro: `- pregunta` + respuesta con sangría, sin números, «(inactiva)» en las
    apagadas; `faqsAsText`), y cada FAQ se queda **abierta** hasta cerrarla a mano (varias a la vez).
    **Borrar varias** (28-sep-2026): barra fija arriba de la lista con el botón «Seleccionar»
    (sin él no hay casillas, ajuste del dueño). Al pulsarlo: casilla por pregunta, «Seleccionar
    todas» (las de la lista a la vista: respeta búsqueda y filtro; cambiarlos vacía la selección),
    «Cancelar» (sale del modo) y «Borrar (N)» → `deleteAgentFaqs` → `deleteFaqs`: UNA
    transacción, UNA versión y una fila de Historial; las que otro ya borró se ignoran; al
    terminar sale del modo. Sigue el «Borrar» de cada pregunta abierta.
  - **Canales** (antes «Implementar»): los canales con interruptor Encendido / Apagado. Desde el
    28-sep-2026 solo los **no archivados** (hoy solo «WhatsApp Diluvium»); el Sandbox y el Número
    de prueba archivados se **ocultan, no se borran** (sus chats, mensajes y contactos siguen igual).
    El texto de ayuda dice «se reactiva con «Activar»» (el botón del Detalle).
  - **Historial** (Bloque A, 28-sep-2026; completado en el Bloque E; `?seccion=historial`, todos los
    roles): una fila por cambio con **quién**, **qué**, **antes → después** y **fecha y hora de
    Mazatlán**, lo más nuevo arriba (200 filas; con fechas se ve más atrás). Filtros: **Tipo**
    (Opciones del Agente IA · Goal y FAQs · Nombre del agente · Modelos · Etapas · Canales · Workflows ·
    Tallas y medidas · Mensajes rápidos · Plantillas · Vendedores · Pausas por chat), **Desde / Hasta**
    (días de Mazatlán) y **«Mostrar pausas automáticas (un vendedor contestó, contestador automático,
    pidió un asesor y vuelta sola)»** (ocultas de fábrica). **Vendedores** solo lo ven **owner y admin** (ni la
    opción del filtro ni sus filas le llegan a un vendedor; lo revisa el servidor con `member:update`).
    Fuentes (`lib/historial/queries.ts`): **Opciones** = `ai_config_changes` (ya existía);
    **Goal y FAQs** = `ai_knowledge_versions` (antes → después = palabras del Goal o número de
    preguntas contra la versión anterior; sin autor = «Versión … guardada por el sistema»); lo demás
    = tabla **`change_history`** (migración **0042**, append-only, con `organization_id`), escrita en la
    **misma transacción** que el cambio (`lib/historial/log.ts`):
    - Modelo 1 y 2 (nombre del modelo) · **nombre del agente** (Ángela ✎, antes → después).
    - Etapas: crear, renombrar, borrar (a qué etapa pasaron sus contactos), reordenar (orden completo
      antes → después), papel, modelo y **regla del Agente IA** (la fila muestra el inicio del texto; el
      color **no** se registra).
    - Canal encendido/apagado · workflows: crear (también «Restaurar predeterminados»), editar (solo lo
      que cambió), encender, apagar y borrar.
    - **Tallas y medidas** (guardar sin cambios no deja fila; con un solo cambio la fila lo dice completo,
      p. ej. «Estándar · 1: 60–90 cm → 60–95 cm»).
    - **Mensajes rápidos**: crear, editar (la fila dice el cambio de nombre; el texto va en «Ver
      cambios») y borrar, con su texto. Los usa y edita cualquier rol, así que todos lo ven.
    - **Plantillas**: «Sincronizar» (cuántas hay en Meta y cuántos cambios: nuevas, cambio de estado,
      cambio de texto, quitadas en Meta) en la misma transacción que la sincronización; el **alta** vive
      en Meta (no hay transacción nuestra que compartir): su fila se escribe en cuanto Meta la acepta.
    - **Vendedores** (solo owner/admin): alta (rol), cambio de rol, desactivar, reactivar y **contraseña
      restablecida sin mostrarla** (la contraseña nunca llega al historial). Desactivar, reactivar y la
      contraseña se escriben con drizzle en **una transacción** con su fila (las mismas columnas que tocaba
      el `internalAdapter` y el borrado de sesiones; el trigger «≥1 owner activo» sigue mandando: si
      truena, no queda fila). El **alta** y el **cambio de rol** los hace Better Auth con sus reglas y su
      transacción: la fila se escribe en cuanto Better Auth confirma (`logTeamChange`).
    - Por chat: «Pausar agente» (y «Apagar» de la tarjeta de error) y «Activar» **con quién**, y las
      **automáticas** (quién = «Automático»): «un vendedor contestó», **parecía un contestador automático**
      (y el viejo «tope de respuestas», opción quitada el 7-oct-2026), **el cliente pidió un asesor** y la **vuelta sola** al cumplirse la hora de regreso (`reactivateDuePause`, que ahora
      bloquea la fila, reactiva y escribe en una transacción).
    `subject` guarda el nombre del contacto / etapa / canal / workflow / vendedor en ese momento y
    `subject_id` no tiene llave foránea: la fila sobrevive aunque se borre lo que nombra.
    **No entra** (es trabajo diario y ya se ve en cada contacto): mover contactos de etapa, mandar
    mensajes y los comentarios.
  - **«Ver cambios»** (Bloque E, migración **0043**: columna `change_history.detail` jsonb, nula): en cada
    fila que lo permite, un botón abre lo **quitado (tachado en rojo)** y lo **agregado (en verde)**. Se
    pide al abrirlo (`getChangeDiff`, una fila a la vez; la lista sigue ligera). Motor puro:
    `lib/historial/diff.ts`.
    - **Goal por párrafo**, comparando dos versiones seguidas de `ai_knowledge_versions` (ya guardan el
      texto completo): párrafo agregado, quitado o **editado** (si se parece ≥ 40 % al que reemplaza, se
      resalta por palabras); lo igual solo se cuenta («12 párrafos sin cambios»).
    - **FAQs por pregunta**: agregada, borrada o editada (pregunta/respuesta antes → después; apagar una
      pregunta sale como «Estado»). Se emparejan por id de GHL, por la misma pregunta y, lo que sobre, por
      la misma posición.
    - **Workflows paso por paso**: nombre, estado, descripción, disparadores (palabras clave, comando,
      etapa, «lo usa el agente») y cada paso (texto, archivo por su nombre, pie, espera); un paso agregado
      al inicio no marca todos los demás.
    - **Regla de etapa, nombre del agente, mensajes rápidos, alta de plantilla**: texto antes → después.
    - **Tallas**: por talla (rango antes → después, agregada, quitada). **Sincronizar plantillas**: una línea
      por plantilla que cambió.
    - Las filas de antes de la 0043, las Opciones (ya dicen antes → después), las pausas y los vendedores
      no tienen «Ver cambios».
  - Ya no están: selector de filtro (queda Luna), "Probar modelo", tabla de precios (los
    precios siguen internos para el gasto), tiempos, pausas y límites.
  - Nota de costo: un Goal con `{{contacto.nombre}}`/`{{vendedor.nombre}}` cambia el
    system por conversación y la caché del proveedor se reutiliza menos.
- **Detalle del contacto:** "Llegó por anuncio" con el resumen corto que deja Luna
  (`messages.metadata.agenteAnuncio.anuncio`); si Luna aún no lo procesó, el título y
  texto del anuncio.
- **Dashboard → Gasto de IA** (solo owner/admin): gasto del **mes** (días de Mazatlán) por
  proveedor y **saldo estimado** = recargas − gasto desde la primera recarga
  (`ai_credit_topups`, owner/admin las registran con monto y fecha). Aclara en pantalla
  que es un estimado (tokens del CRM × precios internos, sin impuestos).

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

## Llaves (Railway)

`OPENAI_API_KEY` y `ANTHROPIC_API_KEY` van en el **servicio web** (`crm-diluvium`),
en `production` y `staging` (el web las usa para saber qué modelos salen en gris en el
selector; el dry-run "Probar modelo" se quitó de la pestaña el 24-sep-2026), y se
referencian desde el **worker**:

```bash
railway variable set 'OPENAI_API_KEY=${{crm-diluvium.OPENAI_API_KEY}}' -s worker -e staging
railway variable set 'ANTHROPIC_API_KEY=${{crm-diluvium.ANTHROPIC_API_KEY}}' -s worker -e staging
```

**En producción el worker es OTRO servicio: `worker-production`** (id 189e0d41). El
servicio `worker` (id e2140b5d) existe SOLO en staging; en production no tiene
instancia. **Nunca usar `-s worker -e production`**: guarda variables huérfanas que
nada lee (pasó en la Fase A; se borraron el 22-sep-2026). Con un servicio sin instancia
en ese entorno, apuntar por ID (`-s e2140b5d-…`) en vez de por nombre. Estado al
22-sep-2026: las llaves de IA están en `worker-production` como referencia al web:

```bash
railway variable set 'OPENAI_API_KEY=${{crm-diluvium.OPENAI_API_KEY}}' 'ANTHROPIC_API_KEY=${{crm-diluvium.ANTHROPIC_API_KEY}}' -s worker-production -e production
```

Comillas **simples**:
zsh trata `${{...}}` como *bad substitution* con comillas dobles. Una opción del
selector cuya llave falte queda en gris automáticamente.

**Fase E — llaves nuevas** (mismo patrón: el valor en el web, el worker lo referencia):
`GEMINI_API_KEY` (Gemini), `GROK_API_KEY` (Grok) y `QWEN_API_KEY` (Qwen).

```bash
railway variable set 'GEMINI_API_KEY=${{crm-diluvium.GEMINI_API_KEY}}' 'GROK_API_KEY=${{crm-diluvium.GROK_API_KEY}}' 'QWEN_API_KEY=${{crm-diluvium.QWEN_API_KEY}}' -s worker-production -e production
railway variable set 'GEMINI_API_KEY=${{crm-diluvium.GEMINI_API_KEY}}' 'GROK_API_KEY=${{crm-diluvium.GROK_API_KEY}}' 'QWEN_API_KEY=${{crm-diluvium.QWEN_API_KEY}}' -s worker -e staging
```

## Nota para la Fase B (panel de gasto)

El runtime del Agente (Fase B) **debe PERSISTIR tokens/uso por mensaje procesado**
(input, output, caché read/write, modelo, proveedor). `callModel` ya devuelve ese
`usage` normalizado (`ModelUsage`); falta escribirlo por mensaje en la base cuando
el agente responda de verdad. Eso alimenta un **panel de gasto** futuro (no se
construye ahora). **Hecho:** el runtime escribe `ai_usage` por llamada (23-sep-2026) y el
Dashboard ya muestra el gasto del mes y el saldo estimado (24-sep-2026).

## Roadmap del Agente IA (B → C → D → E)

- **Fase A (hecha):** fundación del modelo — multi-proveedor, catálogo, `ai_config`,
  pestaña "Agente IA". El agente todavía no responde.
- **Fase B (CERRADA el 24-sep-2026):** parte 1 en producción desde el 23-sep (main 65473e8) y
  parte 2 desde el 24-sep (main b66610a, migración 0026). **Prueba en vivo del dueño (24-sep,
  sandbox, +52 668 242 6364), aprobada:** texto normal; 3 mensajes seguidos → 1 respuesta;
  3 compuertas de 95 cm = talla M, 3 × $5,500 = $16,500; descuento y contra entrega sin
  pausarse; foto leída; "quiero hablar con una persona" → aviso y sigue activo; respuesta
  desde la Bandeja → pausa y "Reactivar" → vuelve. 7 llamadas al cerebro, 0 errores, $0.11 USD.
  Para afinar con el número oficial: ante "¿hacen descuento?" el Goal pide pase a humano y
  el agente respondió él mismo sin dejar aviso; "ok, gracias" no se llegó a enviar.

  Runtime que **responde por texto**, en el worker.

  **Definición del dueño (23-sep-2026, cierre de la Fase B):** el agente es el motor que hace
  que siempre haya alguien respondiendo, como Ángela en GHL. Se rige **solo** por el Goal y las
  FAQs; nada se interpone entre el agente y el cliente.
  - **Responde todo lo que entra**, sin trabas: sin borrador (ni tarjeta, ni Enviar/Descartar,
    ni modo Borrador: el canal queda **Apagado / Encendido**), sin guardia de salida, sin
    presupuesto diario y sin topes (dueño, 7-oct-2026: **nunca** un tope de respuestas). El único
    freno es el de contestadores automáticos (abajo, 7-oct-2026). El gasto lo controlan las llaves de
    OpenAI/Anthropic y el saldo del Dashboard. La migración 0025 apagó los canales que estaban
    en borrador, descartó los borradores vigentes y levantó las pausas viejas.
  - **Pausa:** SOLO cuando un vendedor contesta en la conversación (Bandeja, pop-up del Embudo,
    programado o, con el número real, la app del celular). Se reactiva solo a mano con
    "Reactivar" (Bandeja o Detalle del contacto). Nada más pausa.
  - **Freno ante contestadores automáticos (7-oct-2026, caso Estafeta;
    `lib/ai/runtime/contestador.ts`):** el WhatsApp de Estafeta le mandó al número un aviso con
    botones (Meta lo pasa como «no compatible», 131051); el Agente IA saludó y el contestador de
    Estafeta respondió «Perdón, no estoy seguro de haber entendido bien…» más su menú, 102 veces en
    78 minutos (se detuvo solo porque fallaron los dos modelos). Regla: si en las últimas **3
    vueltas** que contestó el Agente IA el contacto **solo** mandó lo mismo que ya había mandado
    (texto idéntico de 20 letras o más, sin importar mayúsculas ni espacios) o avisos que WhatsApp
    no deja ver, el Agente IA **no contesta** (no llama al modelo), se **pausa hasta «Activar»**
    (`pausado_humano`, Historial `pausa_bucle`) y deja el aviso 🤖 `contestador` (tarjeta amarilla
    en el Embudo hasta «Activar»). No cuentan como «nada nuevo»: textos cortos repetidos («sí»,
    «ok»), fotos, audios o archivos, ni lo que Instagram no deja ver. Un vendedor que contesta en
    medio o un «Activar» vuelven a empezar la cuenta. En esa pausa un seguimiento no sale solo:
    queda como sugerencia, como con «Pausar agente» puesto a mano (despertaría otra vez al
    contestador). Simulado sobre los 1,806 chats de producción (7-oct): solo el de Estafeta la
    cumple (se habría frenado a las 08:37 con 5 respuestas en vez de 102).
  - **Pase a humano:** el agente le dice al cliente que un vendedor lo atenderá (o le enviará
    los datos bancarios), deja un **aviso visible en la Bandeja** (`ai_agent_notices`) y sigue
    activo hasta que un vendedor conteste. La señal `[TRANSFERIR]` nunca llega al cliente.
  - **Historial:** el cerebro lee **toda** la conversación. Protección técnica: si un chat no
    cabe en el modelo (~300 mil caracteres), toma lo más reciente sin fallar; un mensaje pegado
    enorme se recorta a 4,000 caracteres y van como imagen las 20 fotos más recientes.
  - **Mensajes para celular** (formato del Goal): información y pregunta separadas por línea en
    blanco → 2 mensajes (primero la información) con pausa de 1.5 s; bloque corto → 1 mensaje;
    bloque largo (> 320 caracteres) → 2 mensajes cortados entre oraciones.
  - **Espera para juntar mensajes seguidos:** 15 s fija (tope 60 s desde el primero), interna.
  - **Filtro (GPT-5.6 Luna):** no deja a nadie sin respuesta. Solo limpia la metadata del
    anuncio de Click-to-WhatsApp (`lib/ai/runtime/ad-cleaner.ts`): el cerebro recibe solo lo
    que escribió el cliente y el resumen del anuncio queda guardado en el mensaje
    (`metadata.agenteAnuncio`). Sin anuncio no se llama; si falla, un respaldo sin modelo.
  - **Cerebro:** Goal completo + las 47 FAQs activas (cacheados). El runtime solo agrega: qué
    devolver (solo el texto para WhatsApp), cómo activar "Transferencia a humano" / "Datos
    bancarios" (`[TRANSFERIR]`) y que tablas, videos y cambios de etapa aún no existen.
  - Etiquetas internas "pasar a humano" / "revisión humana": ya no se crean y no se muestran.

  **Robustez (revisiones de Claude, cyber-neo y Codex, 23-sep-2026):**
  - **OFF no toca nada:** los ganchos de la ingesta y del envío solo LEEN con el canal
    apagado; todo va en try/catch y la ingesta aísla los ganchos
    (`lib/ai/runtime/isolation.int.test.ts`). Filtro por organización en todo el runtime.
  - **Idempotencia y cortes:** un entrante ya atendido no se vuelve a contestar; encender el
    canal o "Reactivar" es corte (no contesta historia); el barrido rescata entrantes sin job de
    los últimos 30 min. Un cliente que escribe durante la generación hace que la respuesta se
    descarte y se regenere con TODO (máx. 3 rondas; luego vuelve a la espera, nunca en bucle).
  - **Envío sin carreras:** antes de CADA mensaje se relee el estado; si un vendedor responde o
    pausan/apagan al Agente IA, el resto ya no sale y queda en una tarjeta con el texto. Si el
    cliente escribe cuando ya salió el 1.er mensaje, la respuesta se termina (5-oct-2026, ver
    «Respuesta que ya empezó se termina»); antes del 1.er mensaje se descarta y se regenera. Un envío en camino detiene los
    siguientes y el agente no responde encima. Una respuesta de 2 mensajes guarda antes un
    **plan durable**; si el worker se reinicia a la mitad, el barrido lo concilia por
    `created_at` ≥ `resolved_at` (los dos con el reloj de Postgres): nada salió → el entrante se
    vuelve a atender; salió una parte → aviso con lo que faltó (nunca se reenvía: podría
    duplicar). Un envío fallido o sin confirmar deja un aviso por mensaje.
  - **Límite de Zernio (429; Bloque B, 28-sep-2026):** no es un fallo. La burbuja o el archivo del
    workflow espera su turno (lo que diga Zernio, tope 5 min) y sale con la misma clave; no hay
    tarjeta "El agente no pudo responder" ni corrida fallida por eso. Las burbujas y los archivos
    salen en orden dentro de la conversación (`lib/messaging/send-turn.ts`, `docs/bandeja.md`).
  - **Datos bancarios (/banco o agente) que no llegan (Bloque B):** si el worker se reinicia a la
    mitad, al retomar solo cuenta como enviado lo que WhatsApp confirmó (enviado/entregado/leído); un
    archivo fallido detiene la corrida, **no** mueve a Cerca de compra y deja la tarjeta con el
    motivo. Si WhatsApp lo acepta y minutos después avisa que falló (p. ej. 131053), queda la tarjeta
    «No le llegó al cliente la imagen de Datos bancarios: <motivo>. Vuelve a mandarla con /banco.»
    (`lib/workflows/delivery-notice.ts`); la etapa no se regresa.
  - **AUTO con clientes reales (número real):** bloqueado hasta el approve de Codex del agente
    completo. En el sandbox (solo el teléfono del dueño) está autorizado.
  - **Antes de clientes reales** (no dañan a un cliente hoy; no abren ronda):
    - ~~Sin frenos, un bucle con otro contestador automático (dos agentes contestándose) gastaría sin límite hasta
      que alguien lo note en el Dashboard; el cliente escribiendo sin parar solo retrasa.~~ Pasó el 7-oct-2026
      (Estafeta) y se resolvió con el freno ante contestadores automáticos (arriba).
    - El cerebro ya no tiene la regla de no revelar sus instrucciones (no está en el Goal): un
      cliente podría pedírselas.
    - Conciliación de planes por hora de Postgres y no por id de plan en cada mensaje.
    - ~~El barrido de avisos de envíos fallidos recorre `messages` cada minuto sin índice propio.~~ Resuelto
      28-sep-2026: migración 0044 (`messages_created_idx`).
    - Informativo: la conversación (con datos del cliente) y URLs firmadas de imágenes van a
      OpenAI/Anthropic; CLAUDE.md §4 dice "solo GitHub, Railway y Meta" (decisión del dueño).

  **Migración de la Fase B (resuelto 23-sep-2026):** la migración del runtime es la
  `0024_agente_ia_runtime` (regenerada sobre main da53cc4, `when` posterior a la 0023 de
  main). El aviso viejo de una "0014" aplicada en staging ya no aplica: el 23-sep staging
  tenía 24 migraciones (hasta la 0023 de main), solo `ai_config`/`ai_knowledge` y ningún
  canal encendido; la 0024 crea sus tablas y columnas sin chocar.
- **Fase B, parte 2 (24-sep-2026, en main b66610a, rama `feat/agente-ia-editor`, migración
  `0026_agente_editor_y_saldo`):** la pestaña "Agente IA" pasa a ser el editor estilo GHL
  (ver "Qué hay"), el Detalle del contacto muestra "Llegó por anuncio" y el Dashboard muestra
  el gasto del mes y el saldo estimado por proveedor. La 0026 solo AGREGA: tablas
  `ai_knowledge_versions` y `ai_credit_topups`, y columnas `ai_config.agent_name` (default
  "Ángela") y `ai_config.company_name`. No cambia datos existentes. La **0027** queda
  reservada para la Fase D.
  - **Valores personalizados:** el runtime sustituye `{{contacto.nombre}}`,
    `{{vendedor.nombre}}`, `{{empresa.nombre}}` y `{{agente.nombre}}` en el Goal y en las
    FAQs por conversación, antes de llamar al cerebro. El Goal y las 47 FAQs de producción
    no tenían llaves `{{…}}` al 24-sep-2026 (ni las copias del Goal del 27-sep): el cerebro
    recibe exactamente lo mismo que antes. Desde el 28-sep-2026 ya no hay botón para
    insertarlas (solo a mano). Ojo: el nombre del agente (✎) solo llega al modelo por
    `{{agente.nombre}}`; con el Goal de hoy, cambiarlo no cambia cómo se presenta.
  - **Versiones:** cada guardado del Goal y cada cambio de FAQs (agregar, editar,
    activar/desactivar, borrar, restaurar) deja una foto completa en `ai_knowledge_versions`;
    la primera vez guarda también la anterior. "Restaurar" deja, a su vez, otra versión.
  - **Nombre del agente y de la empresa** se guardan cada uno por separado (cambiar uno no
    regresa el otro a un valor viejo).
  - **Saldo estimado:** recargas registradas − `ai_usage.cost_usd` desde el día (hora de
    Mazatlán) de la primera recarga del proveedor. Es un estimado: depende de los precios
    internos (`lib/ai/pricing.ts` + `ai_model_prices`) y no incluye impuestos.
  - **Sin gasto de pruebas (decisión del dueño, 24-sep-2026):** se quitó por completo el "gasto
    dividido" (la tarjeta leía el gasto de staging por `GET /api/internal/ai-spend`). Ya no existe
    el endpoint ni el lector: la tarjeta muestra solo el gasto del mes por proveedor y el saldo
    estimado = recargas − gasto de producción. `AI_SPEND_TOKEN` y `STAGING_APP_URL` ya no se usan
    (si se llegaron a poner en Railway, se pueden borrar).
  - **Seed del conocimiento:** desde que existe el editor, `npm run seed:ai-knowledge` se
    niega a correr si la organización ya tiene versiones (el Goal o las FAQs se editaron en
    la pestaña): pisaría lo editado sin dejar versión. `SEED_FORCE=1` lo obliga.
  - **Revisión de Codex (24-sep-2026), bajos que no abren ronda:**
    - El saldo se calcula por organización, pero la llave del proveedor es global: lo que
      gasten staging u otra app con la misma llave no se descuenta. La pantalla lo aclara.
    - Registrar una recarga no es idempotente: si se pierde la respuesta y se captura otra
      vez, queda duplicada (se ve en la lista y se borra con "Borrar").
    - `{{vendedor.nombre}}` ya ignora a un vendedor desactivado ("un asesor"); en v1 las
      conversaciones no tienen asignado, así que hoy siempre sale "un asesor".
- **Fase C:** follow-ups automáticos — "ocupado" a las 2h; "dejó de responder" a los
  4 días con plantilla fuera de la ventana de 24h; horario 8:00–17:00.
- **Fase D (CERRADA el 25-sep-2026; en producción desde main 057725c, migración 0031):** el cerebro recibe herramientas en la misma llamada
  (AI SDK `tools` sin `execute`, una vuelta): `wf_<slug>` por cada workflow de media habilitado
  (Automatización), `fijar_cotizacion`, `mover_etapa` (solo hacia adelante; la etapa del vendedor manda) y
  `aviso_vendedor` (cotejar_deposito | cliente_pide_humano | comprobante_dudoso → aviso 🤖 en la Bandeja,
  nunca pausa). El CRM no verifica montos: el agente decide con su Goal y su lectura de la imagen o PDF;
  el CRM guarda el comprobante leído (`comprobantes`) y avisa si la referencia ya se usó con otro
  contacto. Contexto del CRM (etapa, cotización, comprobantes) al final del último turno del cliente.
  Diseño y texto del Goal: `docs/fase-d-diseno.md` §10. **Prueba B5 en producción (25-sep):** pasaron
  los pasos 1, 3, 4 y 5; el 2 y el 6 con observaciones. El Goal de producción es la versión 2 del
  historial. Pendientes A–F (sin construir) y resultado completo: `docs/fase-d-diseno.md` §11.
- **Fase E (CERRADA el 26-sep-2026, main ebcd981; definición del dueño del 25-sep):** Modelo 1 (Luna) y Modelo 2 (Sonnet 5) por etapa,
  cada uno con su selector en la pestaña Agente IA, más el reenvío seguro. **Hecho en la rama
  `feat/agente-ia-fase-e` (migración 0033):** los dos selectores y la asignación por etapa
  (Modelo 1 = Inbox, Prospecto e Interesado, decisión del dueño), adaptadores de Google, xAI y
  OpenRouter con sus precios, tope de 4,096 tokens con aviso si se corta (parte del pendiente B
  de la Fase D), sin sección "Empresa" y favicon nuevo (main 0f495e9). **Parte 2 (migración 0034):**
  - **Reenvío seguro** (definición del dueño, 25-sep): si el modelo falla, el CRM NO lo vuelve a
    llamar solo. Deja en el chat la tarjeta ⚠ 🤖 "El agente no pudo responder" con el error en
    palabras simples (sin saldo, llave faltante o inválida, proveedor saturado, tardó demasiado,
    rechazó la conversación, respuesta vacía; `lib/ai/runtime/model-errors.ts`) y los botones
    **Reintentar** (un intento más, ya) y **Apagar** (pausa al agente solo en esa conversación;
    "Reactivar" lo regresa). Mientras nadie elija, ni mensajes nuevos, ni la cola, ni el barrido
    vuelven a llamar al modelo ahí. Única excepción: si el proveedor está **saturado** se reintenta
    UNA vez sola tras 10 s. Los adaptadores ya no usan los reintentos ocultos del SDK (`maxRetries: 0`).
  - **"Depósito recibido"**: el aviso de pago es un texto fijo, sin montos, folio ni texto del modelo.
    El agente ya no anota monto/folio y se quitó el chequeo de folio repetido (decisión del dueño);
    la tabla `comprobantes` queda sin uso. El contexto del CRM ya no lista comprobantes.
  - **Caché del historial** (Anthropic): segundo punto de caché antes del último turno del cliente;
    probado con Sonnet 5 real: la 2.ª llamada leyó de caché 4,931 de 4,962 tokens de entrada.
  - La nota "ya salió por palabra clave" solo queda en el log del worker (ya no es aviso al vendedor).
  - Revisión adversarial de Claude (Codex sin sesión el 25-sep): una tarjeta VIEJA ya no bloquea
    tras "Reactivar" o tras encender el canal (solo bloquea si es posterior al último cambio de
    estado); cuando el agente vuelve a contestar, las tarjetas abiertas quedan "superadas"; no hay
    tarjeta si durante la falla un vendedor contestó o pausaron al agente; "Reintentar" que no
    pudo programar la corrida reabre la tarjeta; "Apagar" pausa antes de cerrar la tarjeta; el
    aviso automático al mover a Compra sin comprobante es neutral y no sale junto a "Comprobante
    dudoso"; el punto de caché de Anthropic va antes de la primera foto o PDF (su URL firmada
    cambia en cada respuesta y la caché no se reutilizaría).
  - Llaves con los nombres de Railway: `GEMINI_API_KEY`, `GROK_API_KEY`, `QWEN_API_KEY` (valor en
    el web de producción; `worker-production` las referencia). Prueba real del 25-sep: Gemini y
    Qwen contestan con herramientas; Grok rechazó la llave (hay que volver a copiarla).
  **Parte 3 (25-sep, migración 0035):**
  - **A resuelto:** la conversación para el modelo SIEMPRE termina en el turno del cliente; lo que
    salió por palabra clave después de su mensaje va como nota ("[Después de este mensaje ya se le
    envió al cliente: …]"). Probado con Sonnet 5 real: antes daba el 400 de B5; ahora contesta el
    precio y no repite el video.
  - **Falla al ENVIAR:** si el CRM (ventana cerrada, canal apagado) o WhatsApp rechazan el primer
    mensaje, sale la tarjeta con el motivo y "Reintentar"/"Apagar"; antes la cola reintentaba hasta
    3–5 veces pagando otra llamada al modelo cada vez y dejando burbujas fallidas.
  - **Tope diario de $20:** el dueño decidió quitarlo. La columna `ai_config.daily_budget_usd` se
    borró en la `0037_agente_parte_1` (26-sep-2026).
  - **Dashboard:** "Gasto de IA" hasta arriba con cifras grandes y los cinco proveedores con llave.
  - Decidido NO hacer: indicador "agente con error" en la lista de la Bandeja (el dueño no lo ve probable).
  - **Cierre (26-sep):** Grok funciona (la llave había perdido el guion de `xai-`; tras corregirla en el web
    hubo que volver a desplegar `worker-production`: una variable referenciada solo le llega al worker
    cuando él se despliega). Recargas de saldo: **manuales** desde la página de cada proveedor, sin botón
    en el CRM (xAI y OpenRouter lo permitirían por API; decisión del dueño). La revisión de Codex de las
    tres partes va como penúltima acción antes de conectar el número oficial. El panel de gasto que antes
  se anotaba aquí ya existe en el Dashboard (24-sep-2026); conciliar contra las Cost API queda como
  pendiente sin fase.

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

## Opciones del Agente IA (26-sep-2026)

Rama `feat/opciones-bot`, migración **`0038_opciones_bot`**. Sección **"Opciones"** en la pestaña Agente IA
(hoy su propia subpestaña; la editan vendedores, admin y owner: recurso `aiConfig`). Copia las opciones de Ángela
en GHL. **Regla del dueño: los valores de fábrica son EXACTAMENTE el comportamiento anterior**; nada cambia
hasta que alguien mueva una opción. Reglas puras en `lib/agente-ia/opciones.ts`; lectura con caché en
`lib/ai/runtime/options.ts`; guardado y registro en `lib/agente-ia/opciones-store.ts`; UI en
`app/(app)/agente-ia/_components/bot-options.tsx`.

| # | Opción | Fábrica (= hoy) | En GHL | Columna de `ai_config` | Dónde aplica |
|---|---|---|---|---|---|
| 1 | Tiempo de espera antes de responder (5–60 s) | 15 s | 10 s | `response_delay_seconds` (reusada) | `debounceDelayFor` / `rescheduleDelayFor`; el tope de 60 s desde el primer mensaje nunca es menor que la espera |
| 2 | Pausar al Agente IA cuando un vendedor contesta | Sí | Sí | `pause_on_human_reply` (reusada) | `onHumanOutbound`, compuerta y paradas antes de cada burbuja (con "No" el vendedor no pausa; el agente contesta lo que el cliente escriba después) |
| 2 | Reactivar solo después de | Nunca (a mano con «Activar») / 8 h / 24 h / N h | a mano | `human_reply_reactivate_hours` (nueva) | misma pausa que "Pausar agente": `agent_paused_until` + barrido del worker; el corte es la hora de regreso |
| 3 | Cuando el cliente pide un asesor | Avisar y seguir contestando | avisa y pausa 8 h | `handover_reactivate_hours` (reusada; la 0038 la deja nula) | tras enviar la respuesta y encolar su media (`pauseAfterHandover`), condicional: una pausa de un vendedor manda |
| 4 | Horario del Agente IA (hora de Mazatlán) | 24/7 | 24/7 | `bot_schedule` jsonb `{days[1–7], from, to}` (nueva) | fuera de horario no se programa el job (`debounceDelayFor` → null) y la compuerta dice `fuera_de_horario` (sin pausa). **Apertura:** el barrido (`findPendingAtOpening`) toma los chats cuyo último mensaje es del cliente, sin respuesta, dentro de la ventana de 24 h y posteriores al corte, solo de organizaciones con horario y abiertas ahora, y los reparte **12 por minuto, uno cada 5 s**, sin tocar los que ya tienen job. Con horario, el barrido de huérfanos de 30 min no aplica (lo cubre el de apertura, hasta 24 h) |
| 5 | Responder imágenes | Sí | Sí | `read_images` (nueva) | con "No" no se firma la URL y el modelo ve `[imagen]` (los PDF siguen) |
| 5 | Responder notas de voz | Sí | Sí | `transcribe_audio` (nueva) | con "No" el worker deja la transcripción `omitida` (motivo visible en el chat, sin llamar a OpenAI), el agente no la espera y ve `[nota de voz]` |
| 6 | Longitud de respuesta | Balanceada | Balanceada | `response_length` (nueva) | "corta"/"detallada" = UNA línea al final del sufijo del CRM (`LENGTH_LINES`); el Goal, las FAQs y la caché no cambian |
| 6 | Máximo de mensajes por respuesta | 2 | 1 | `max_bubbles` (reusada) | `toBubbles(text, 1)` manda todo en un mensaje |
| 7 | ~~Máximo de respuestas del Agente IA por conversación~~ | — | 50 | `max_replies_per_contact` (sin uso) | **Quitada el 7-oct-2026** (dueño: nunca un tope de respuestas). Contra un bucle con otro contestador automático está el freno de `lib/ai/runtime/contestador.ts`. Los avisos `tope_respuestas` y las filas `pausa_tope` viejas se siguen mostrando y «Activar» los atiende |

- **Horario a la vista (Bloque C, 28-sep-2026):** si el Agente IA tiene horario (no 24/7), la **Bandeja**
  muestra arriba una franja «El Agente IA solo contesta mié–jue 20:00–6:00 (ahora está fuera de horario)»
  (ámbar) o «(ahora sí está contestando)» (gris), recalculada cada minuto; si el canal está **Apagado**,
  «El Agente IA está apagado en WhatsApp Diluvium» (roja). En el **Dashboard**, la pastilla **"Agente IA"**
  junto a la de WhatsApp: verde contestando, ámbar fuera de horario, roja apagado o **callado**; al abrirla
  dice también **«N chats esperan a un vendedor»** (los atrasados de más de 1 h, Bloque E). Todo sale de la
  base del CRM (`lib/monitoring/bot-status.ts` y `bot-silence.ts`), sin Zernio. Motivo: el 27–28 sep un
  horario "mié–jue 20:00–06:00" dejó al Agente IA 16 h sin contestar sin que nadie lo notara.
- **Alarma "Agente IA callado"** (mismo bloque; ajustada en el Bloque E): dentro del horario y con el canal
  Encendido, 3+ clientes que escribieron en la **última hora** y esperan respuesta hace más de 15 min, y el
  Agente IA sin mandar nada en 15 min → `[monitor] ALERTA` del worker e issue `alerta-whatsapp`. Lo atrasado
  (más de 1 h) **no alarma**: el Agente IA solo rescata por su cuenta lo de los últimos 30 min, así que eso
  lo atiende un vendedor (sale como dato en la pastilla). Lo que cuenta sale de la misma consulta que el
  barrido (`findUnansweredForMonitor`); el horario tiene que llevar abierto los 15 min (la apertura reparte
  lo acumulado). Detalle y variables: `docs/go-live.md` › Monitoreo.
- **Sin redesplegar:** el worker lee `loadBotOptions` en cada trabajo con caché de **60 s** por
  organización; el web borra su caché al guardar. Un valor imposible en la BD cae al de fábrica.
- **Quién cambió qué:** cada guardado deja filas en `ai_config_changes` (organización, usuario, opción,
  antes → después, hora); la sección muestra "Último cambio: Daniel, hoy 11:20 · Tiempo de espera…".
- **Pruebas:** `lib/agente-ia/opciones.test.ts` (fábrica = constantes del runtime, validación, horario en
  Mazatlán incluido cruce de medianoche, permisos por rol), `policy.test.ts`, `brain.test.ts` y
  `lib/ai/runtime/opciones.int.test.ts` (regresión con fábrica, una prueba por opción, caché, apertura del
  horario con reparto, tope con tarjeta amarilla y aislamiento por organización).
- **Revisión de Codex (26-sep, adversarial; a la lista de la revisión final, decisión del dueño):**
  corregido ya: «Activar» atiende el aviso del tope (la tarjeta deja de estar amarilla). Pendientes:
  (1) con varias organizaciones con horario, el `LIMIT 12` del barrido de apertura va antes de filtrar
  "abierta ahora" (hoy hay una sola organización); (2) pasar de horario a 24/7 deja sin rescatar lo
  pendiente de más de 30 min; (3) una segunda respuesta del vendedor no extiende la pausa con horas;
  (4) "pedir asesor → pausar" puede dejar sin enviar la media pedida en esa misma respuesta; (5) un
  «Reintentar» de respuesta guardada no cuenta para el tope; (6) si el aviso del tope falla al guardarse,
  la pausa queda sin aviso; (7) re-aplicar a mano la 0038 regresaría "pedir asesor" a "avisar y seguir";
  (8) teórico: el barrido no correlaciona `organization_id` en canal/mensajes.
- **Aceptado / teórico:** una pausa por "pedir asesor" deja "agente_pausado" la media que el agente pidió en
  esa misma respuesta si su corrida corre después de la pausa (caso raro: al pasar a humano no se piden
  archivos). Un vendedor que contesta otra vez durante una pausa con hora no la extiende (igual que
  "Pausar agente"). El reparto de apertura es por worker (un solo worker en Railway).

## Columnas del Embudo (27-sep-2026)

Rama `feat/columnas-embudo`, migración **`0041_columnas_embudo`**.

- **Datos.** Tabla `funnel_stages` por organización: clave estable, nombre, orden, papel, regla del Agente IA y modelo (1 o
  2). La columna `color` existe pero no se usa: el dueño quitó el color el 27-sep (todas las columnas en azul). `contacts.stage` y `workflows.trigger_stage` pasan de enum a texto con llave foránea compuesta. La
  0041 siembra las 5 de siempre con las mismas claves y nombres; la regla de cada una es la del bloque "ETAPAS DEL
  EMBUDO" del Goal de producción y el modelo se copia de `ai_config.etapas_modelo_1` **vigente al migrar**. Toda
  organización nueva nace con las 5 (trigger `funnel_stages_seed_org`). `ai_config.etapas_modelo_1` queda sin uso
  (se conserva para que el web y el worker anteriores funcionen durante el despliegue; borrarla en una migración
  posterior). Volumen de prueba: 10,973 contactos con el reparto de producción, `db:deploy` en 0.6 s y conteos iguales.
- **Papeles** (uno por etapa, cada uno en exactamente una): Entrada (contactos nuevos; siempre la primera columna),
  Cerca de compra (datos bancarios y /banco) y Venta cerrada (un vendedor confirmó el pago en el chat, desde el 2-oct;
  Anuncios › Compraron). Cerca de compra va antes que Venta cerrada. Una etapa con papel se renombra, pero no se borra hasta pasar su papel.
  Entre 3 y 10 etapas.
- **Agente.** Al final del system (después del sufijo del CRM y de la longitud) va el bloque "ETAPAS DEL EMBUDO
  (las define el CRM)" con clave, nombre y regla en el orden actual. `mover_etapa` acepta solo las claves
  vigentes; "solo hacia adelante" sigue el orden actual. El contexto del CRM muestra el nombre vigente. El modelo
  de cada etapa, el traspaso Luna → Sonnet y el respaldo entre modelos leen `funnel_stages.model_slot`
  (`lib/ai/runtime/model-by-stage.ts`); datos bancarios implica la etapa con papel Cerca de compra.
- **Editor.** Subpestaña **Etapas** de Agente IA (en Modelos queda un enlace) y el lápiz del Embudo (mismo
  componente, `app/(app)/_components/stages-editor.tsx`). Todo cambio pide confirmación (TopConfirm). Borrar pide a
  qué columna pasan los contactos y los mueve en una transacción (candado de la fila: un movimiento concurrente
  espera y falla limpio), deja sin etapa los workflows que se disparaban al entrar y manda UN `stages.updated`.
  Lo editan vendedores, admin y owner (ACL `funnelStage`).
- **Resto del CRM.** Ingesta y contactos nuevos: etapa con papel Entrada. /banco: papel Cerca de compra. Anuncios:
  papel Venta cerrada. Importador GHL: nombre vigente de la columna (y, de respaldo, el nombre de siempre si su
  clave sigue). Dashboard, Detalle, chip del chat, avisos emergentes y Automatización leen los nombres del
  contexto en vivo (`funnel-stages-provider.tsx`, relee también en cada reconexión del SSE).
- **Goal.** El bloque "ETAPAS DEL EMBUDO" del Goal se vuelve redundante. La versión nueva del Goal sin ese bloque
  se aplica solo con el "OK GOAL ETAPAS" del dueño (propuesta en `~/Documents/Diluvium CRM/notas/goal-etapas-propuesta/`).
  Mientras no se aplique, las dos listas dicen lo mismo; si se edita una regla antes, el Goal viejo la contradice.
- **Revisión (27-sep):** Claude adversarial + Codex + cyber-neo (0 reales). Corregido con prueba: orden de los papeles
  (Entrada primero, Cerca de compra antes que Venta cerrada), relectura de etapas al reconectar, candado al borrar,
  importador con el nombre de siempre.
- **Teóricos (sin escenario real hoy):**
  - Si alguien pone una etapa sin papel DESPUÉS de Venta cerrada y un contacto está ahí, un pago ya no lo mueve a
    Venta cerrada (sería retroceso); el aviso "Depósito recibido" del agente sí le llega al vendedor.
  - Si pasan el papel Venta cerrada a otra columna durante los segundos de una respuesta, el agente mueve a la
    clave que pidió (la vieja).
  - Borrar una etapa deja a sus contactos como movidos por "sistema" (pierden la marca de "lo puso un vendedor") y
    arriba de la columna destino.
  - El editor viejo (1–2 min del despliegue) guarda el modelo por etapa en `etapas_modelo_1`, que ya no se lee.
  - Las etapas nuevas nacen con el Modelo 2 (más caro) hasta que alguien lo cambie.
  - La descripción del workflow "Datos bancarios" (`lib/workflows/defaults.ts`) dice "Cerca de compra" aunque se renombre.

## Agente IA en segundo plano: etapa y Detalle siempre al día (28-sep-2026)

Decisión del dueño: el Agente IA trabaja **siempre** en segundo plano, aunque esté apagado en el canal o
pausado en el chat, con dos trabajos: (1) mover al contacto a la etapa que corresponde y (2) llenar el
Detalle. Antes solo se llenaba en la misma llamada en la que el agente contestaba; con el agente pausado
(p. ej. porque contestó un vendedor, que es lo normal en la parte de la venta donde salen medidas y montos)
nadie leía el chat. Migración **`0047_lector_detalle`** (siguiente libre: 0048).

- **Qué es:** `lib/ai/runtime/lector.ts` (base de datos) + `lector-core.ts` (puro: instrucciones,
  herramienta `actualizar_contacto`, cómo se le presenta el chat y validación). Modelo fijo **Luna**
  (`gpt-5.6-luna`). Lee TODO el chat en orden en un solo mensaje ("[28 sept 14:03] Cliente: …", con
  Vendedor, Agente IA o Diluvium (automático)), las 6 imágenes/PDF más recientes del cliente
  (comprobantes, fotos con medidas) y al final la ficha guardada. Nunca le escribe al cliente, no deja
  avisos al vendedor y **no dispara** los workflows "al entrar a esta etapa" (`fireStageTriggers: false`).
- **Cuándo lee:** barrido del worker cada minuto (`lector-worker.ts`): chats con
  `last_message_at > detalle_leido_hasta`, de los últimos 3 días, cuando llevan **3 min sin mensajes** o
  el primer mensaje sin leer tiene **15 min**. Máximo 20 por barrido, 3 a la vez. Lee aunque el Agente IA
  haya contestado (la lectura cuesta ~US$0.0005; así monto, pago y etapa siguen una sola regla). Candado
  Redis por chat (`lector-lock:<id>`). Si el modelo falla, no marca leído y reintenta hasta 3 veces por
  mensaje nuevo. La 0047 marcó todo lo anterior como leído.
  **Mismo reloj (7-oct-2026):** «sin leer» se mide con la hora del mensaje (`coalesce(sent_at, created_at)`, la de
  WhatsApp, igual que `last_message_at` y `detalle_leido_hasta`), no con la de llegada (`created_at`, unos segundos
  después). Antes el último mensaje del cliente parecía sin leer para siempre y el chat se leía al instante con
  cualquier mensaje nuevo, sin los 3 min de calma (así una lectura cayó a media respuesta del vendedor). También en
  la revisión «solo hay seguimientos nuevos» (`lector.ts`) y en la espera del Detalle (`lector-status-store.ts`).
- **Reglas del dueño:** lectura LINEAL, vale lo último que confirmó el cliente, aun tras la compra.
  **Monto de cotización** = total de lo que el cliente eligió al final (si se cotizaron 2 y eligió 1, el
  total de 1); si cambió y el precio nuevo nunca se dijo, no se inventa: comentario "falta confirmar el
  total". **Pago total** (`contacts.pago_total`, nuevo) = lo que ya pagó (anticipo + resto o completo).
  **Etapa:** solo hacia adelante; la que puso un vendedor a mano se respeta: el chat lleva la marca
  "[CRM …: un vendedor movió al contacto a «X»…]" en su lugar del tiempo y, si no hay nada después de ese
  cambio, el código descarta cualquier avance. El aviso emergente sale igual que cuando el agente contesta
  ("🤖 Agente IA movió a …").
- **Montos nunca inventados (código):** el monto debe ser una cantidad que dijo la **empresa** en el chat
  o la suma de hasta 4 de ellas (2 × $5,500; compuerta + instalación); el cliente no puede dictarlo. El pago
  debe aparecer en el chat (o ser suma) o el modelo debe haber visto un comprobante (imagen/PDF).
- **Hallazgo con Luna real (28-sep):** Luna manda SIEMPRE todos los campos; sin `null` los rellenaba con
  0, "" o "no_sabe". En producción el agente ya lo hacía: 46 de 50 niveles de agua escritos por el agente
  eran "0 cm" y 40 de 48 "¿inundaciones?" eran "No sabe". Arreglo compartido (agente y lector): cada campo
  acepta `null` = sin dato, 0 cm se descarta (`parseDetalle`) y "no_sabe" nunca reemplaza un sí/no
  (`applyDetalleByAgent`). `fijar_cotizacion` ahora dice "total de lo que el CLIENTE eligió".
- **Gasto:** `ai_usage.stage = 'detalle'`, **sin message_id** (no cuenta como respuesta ni como error del
  agente sobre un mensaje), outcome `detalle_aplicado` / `detalle_sin_cambios` / `error`; en `error` va
  qué cambió y qué se descartó. Medido con Luna real: US$0.0004–0.0012 por lectura (~1,400 tokens de
  entrada, la mitad en caché).
- **Pasada única:** `npm run lector:detalle -- --desde <ISO UTC> [--ensayo]` (`scripts/lector-detalle.ts`).
  El ensayo solo cuenta y estima; la real imprime chats, tokens y costo (el mismo de `ai_usage`).
- **UI:** Detalle › "Monto de cotización (MXN)" y "Pago total (MXN)" lado a lado, los dos con marca "IA"
  y editables por el vendedor (`pagoTotal` en `updateContactQualification`).

### Indicador en el Detalle (29-sep-2026, pedido del dueño)
Una línea bajo "Calificación" (Bandeja y pop-up del Embudo) muestra en vivo qué hace el lector:
**⏳ leerá el chat en ~N min** (hay mensajes sin leer; misma cuenta del barrido: 3 min quieto o 15 min desde el
primero sin leer, más medio paso del barrido), **leyendo el chat…** (orbe), **actualizó N datos** (6 s, mientras
brillan los campos con la marca IA), **✓ Al día · leído 10:42** y **No pudo leer el chat · se reintenta solo**.
- **Sin sondeo ni costo de IA:** el lector avisa `lector.status` (fase `leyendo` antes de llamar a Luna y, en un
  `finally`, `listo` con cuántos datos cambió o `error`) por el mismo NOTIFY `inbox_events` del tiempo real
  (`lib/inbox/lector-status-payload.ts`, `events.ts`, `use-inbox-stream.ts`). Al abrir el contacto hay UNA consulta
  de solo lectura (`lib/actions/agente-lector.ts` → `lib/agente-ia/lector-status-store.ts` → `lector-status.ts`,
  puro): chats del contacto en la organización de la sesión, candado Redis `lector-lock:<id>` (tope 1.5 s; si Redis
  falla, "no está leyendo") y última fila de `ai_usage` etapa `detalle`. Se vuelve a consultar solo con eventos
  (aviso del lector, mensaje de sus chats, reconexión) o al volver a la pestaña.
- **Si un aviso se pierde** (worker reiniciado a media lectura), "leyendo" se apaga solo a los 90 s y la espera
  vuelve a consultar cuando ya debió leerse. Nunca rompe el Detalle: si algo falla, no se muestra nada.
- UI: `app/(app)/contactos/_components/lector-status.tsx`; mapa › Detalle (28).

## Pregunta duplicada: workflow por palabra clave + Agente IA (28-sep-2026)

- **Incidente (prod, 28-sep 6:27–6:49 p.m. Mazatlán):** «Información» y «Precio 2» (igual que GHL) terminaban con
  «¿Usted tiene problemas de inundaciones?», la misma pregunta que pide el Goal. Como lo que manda un workflow por
  palabra clave no cerraba el mensaje del cliente (regla del 24-sep: "el agente contesta el resto"), el Agente IA
  contestaba el mismo mensaje y repetía la pregunta aunque la nota «ya se le envió» se la decía (Luna la ignoró).
  3 chats en 20 min: Caba Decor Y Estilo y Maria Verdugo (idéntica), Maria (parafraseada). Ese día se quitó la
  pregunta de los dos workflows.
- **Regla nueva (OK del dueño):** si el **último paso** de un workflow por palabra clave es una **pregunta** (texto
  o pie del archivo que termina en "?", `endsWithQuestionStep`), esa pregunta **contesta** el mensaje que lo disparó:
  el ejecutor la marca con `respondeHasta` = hora de ese mensaje, así que lo que el cliente escribió **después**
  sigue pendiente y el agente lo contesta. Mientras la corrida va en camino, el agente **espera** (vuelve a mirar
  cada 5 s, tope 3 min) en vez de contestar encima. Los workflows que NO terminan en pregunta (solo foto/video)
  siguen igual: el agente contesta el resto.
- **Candado anti-repetición** (`lib/messaging/repeat.ts`): ni el agente ni un workflow suyo (corrida del agente o
  por palabra clave) mandan un texto **idéntico** (sin importar mayúsculas ni espacios) a uno que ya salió después
  del último mensaje del cliente. Si ninguna burbuja queda, es como una respuesta de solo acciones; queda en
  `ai_usage.error` ("no se repitió lo que ya salió"). El comando o la etapa de un vendedor salen siempre.
- **Costo aceptado:** si el cliente pregunta dos cosas en el MISMO mensaje ("precio y envían a Monterrey?") y el
  workflow que dispara termina en pregunta, lo segundo espera a que el cliente conteste (como en GHL).
- **29-sep-2026:** la regla automática «termina en pregunta» la reemplazó la casilla «El workflow es la respuesta», y la
  marca `respondeHasta` de la palabra clave cambió a `contestaA` (solo el disparador; bug de la ráfaga). Ver la sección
  «Tabla de tamaños, «Máximo por chat» y «El workflow es la respuesta»».

## «Solo al inicio» (29-sep-2026, migración 0048)

- **Pedido del dueño:** «Precio 2» es la respuesta ya definida para quien llega de un anuncio y su primer mensaje
  es "precio"/"costo". Datos de prod (26–29 sep): de 24 disparos por palabra clave, 14 fueron al inicio (bien) y el
  resto a media conversación ("Cada una cuesta 5.500 pesos", "La mediana que precio tiene"): ahí el guion no encaja.
- **Regla ESTRICTA** (`workflows.trigger_start_only`, `lib/workflows/start-only.ts`), opción del editor
  «¿Cuándo se dispara por palabra clave o por el Agente IA?» → «En cualquier momento» (como antes) o «Solo al inicio»:
  - Solo sale **al inicio**: mientras no haya un saliente que cuente como respuesta: de un vendedor (`crm`,
    `business_app`, incluido el historial copiado del celular) o del Agente IA con **texto propio** (`ai_agent` que no
    es de una corrida de workflow). Lo que mandan otros workflows no cuenta: «Información» y luego "Precio" sí dispara.
  - **Una sola vez por contacto**, por cualquier camino y en cualquier conversación (corrida en cola/corriendo/hecha
    o que ya mandó algo). Nunca se repite.
  - Se aplica a palabra clave y Agente IA (herramienta y etapa movida por el agente). El **comando del vendedor** y
    la etapa que mueve un vendedor salen siempre.
- **Dónde se revisa:** al elegir la palabra clave (`onInboundKeyword`: el que ya no aplica no compite y el mensaje
  puede disparar otro que coincida), al ofrecer herramientas al Agente IA (`loadAgentTools` con la conversación: solo
  se ofrece mientras aplica), al crear la corrida (`startWorkflowRun`, omitida con `ya_no_es_el_inicio` o
  `ya_enviado_a_este_contacto`) y otra vez al arrancar (`executeWorkflowRun`, paso 0: si dos corridas del mismo
  workflow llegan juntas —palabra clave y agente— gana la primera que arrancó).
- **Pendiente (otro chat, análisis del flujo del Agente IA):** «El workflow es la respuesta» — qué hace el agente con
  su propio texto cuando usa un workflow así como herramienta (hoy salen los dos). → Resuelto el 29-sep (sección
  siguiente).

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
    contesta todo lo que el agente leyó (`respondeHasta`); si el workflow no arranca, aviso 🤖 al vendedor con el texto
    que no salió. Si solo manda **archivos** (la Tabla), el agente sí escribía su frase; del 1 al 8-oct-2026 iba como
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
- Pendiente aparte: como **herramienta** del Agente IA con textos («Depende»), su propio texto sigue sin salir; hoy
  ningún workflow con textos tiene «El Agente IA puede dispararlo».

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

## Workflow «es la respuesta» de solo archivos pedido por el Agente IA (9-oct-2026, sin migración)

Caso del dueño (8-oct, captura): activó «Dónde medir la entrada» con su pie («Le comparto un video de como debe medir su
entrada☝🏻») y con «El workflow es la respuesta» marcada. El Agente IA lo mandó con **su** frase de cuatro renglones como
pie (regla del 1-oct), no con la del dueño. Decisión del dueño: usar la casilla actual (opción 1B; la Tabla también la
tiene y el cambio le aplica, aceptado) y que el Agente IA conteste aparte lo que el cliente haya preguntado además
(opción 2A, complemento, como por palabra clave).

- **Texto del modelo:** con un workflow marcado que solo manda archivos, su texto **no sale** (igual que con textos,
  «Depende»): `answerRunsOf` (actions.ts) distingue `textos` y `archivos`. La corrida arranca **sin** `pieDelAgente`: el
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

## El total que la empresa ya dijo también se fija (2-oct-2026, sin migración)

Revisión de producción del 2-oct: 33 avisos «Acción del agente no ejecutada: fijar_cotizacion ignorada: $5500 no aparece
en el texto del agente» desde el 27-sep (15 el 1-oct), 29 seguían como **tarjeta amarilla** en el Embudo sin nada que
atender. En 31 de los 33 el total **sí se le había dicho al cliente**: casi siempre «Precio 2» o «Información» por palabra
clave («Ahorita tenemos cualquier tamaño en $5,500…») y el Agente IA, en complemento, no tenía nada que agregar o contestó
otra cosa sin repetir el precio. El CRM solo aceptaba el monto si venía en el texto propio del agente.

- **Regla nueva** (`quoteBacked` en actions.ts): se fija si el agente lo dice en su texto **o** si sale de los precios que
  la **empresa** (Agente IA, workflows, vendedor) ya le dio al cliente en el chat que leyó el modelo: la cantidad o la suma
  de hasta 4 (2 × $5,500), la misma regla que el lector en segundo plano (`amountsIn` / `isBackedAmount`, lector-core.ts).
  Lo que **dicta el cliente** sigue sin contar (la inyección de cotización de la Fase D, fase-d-diseno.md §8.3).
- Si el total no sale de ningún precio de la empresa, se ignora como antes y queda el aviso («…no aparece en el texto del
  agente ni sale de los precios que la empresa le dio en el chat»). De los 33 del histórico, 2 seguirían así.
- **Monto de un vendedor:** igual que antes, el del agente solo lo reemplaza si su respuesta salió (si no le escribió nada
  al cliente en esa respuesta, se queda el del vendedor).

## Ancho de las entradas siempre en centímetros (2-oct-2026, sin migración)

Pedido del dueño (captura del Detalle con «Entrada 1: 175» sin unidad): que se vea qué medida es, definida por lo que dijo
el cliente y lo que interpreta el Agente IA (no un selector), y que un número sin unidad como 230 sean centímetros, nunca
metros.

- **Detalle:** el ancho de cada entrada lleva «cm» a la derecha, como «¿Cuánta agua entra?». Se guarda siempre en cm
  (`contact_entradas.ancho_cm`) porque los rangos de Tallas y medidas son en cm y de ahí sale el tamaño sugerido.
- **Agente IA y lector** (misma frase, `ANCHO_EN_CM` en tools.ts; la usan `actualizar_detalle` y el lector en segundo
  plano): convierte lo que dijo el cliente — metros × 100 (1.75 m, «1.75» o «1 metro 75» = 175), pulgadas × 2.54 (70
  pulgadas = 178); un número sin unidad de 10 o más ya son centímetros (230 = 230 cm, nunca metros).
- **Red de seguridad** (`parseDetalle`): un ancho de menos de 10 son metros que el modelo no convirtió (1.75 → 175 cm).
  Antes se redondeaba y quedaban 2 cm. En producción (2-oct) los 46 anchos guardados ya estaban en cm (70–405).

## Compra = un vendedor confirmó el pago (2-oct-2026, sin migración)

Caso real del 2-oct: un cliente pagó el **anticipo** de $3,500 de una compuerta a la medida de $7,000; el Agente
IA contestó «Recibimos su anticipo ✅» y, horas después, el vendedor «Confirmo de recibido ✅». El Agente IA en segundo
plano lo leyó a las 8:57 y lo dejó en «Cerca de compra» porque la regla de entonces decía «Cerca de compra … cuando
confirmas un anticipo» y «Compra … por el total». **Regla nueva del dueño:** anticipo = Compra, pero el pago lo valida
un **vendedor**: revisa el comprobante, ve qué se pagó y se lo confirma al cliente en el chat.

- **Código** (`lib/ai/runtime/venta-cerrada.ts`, puro): la etapa con papel **Venta cerrada** solo se pone si en el chat
  hay un mensaje de un vendedor (`crm` o `business_app`, igual que `HUMAN_SOURCES`) **después del último** comprobante
  del cliente (imagen o documento). El último: una foto de la puerta con un vendedor después no respalda un pago que
  llega más tarde. La confirmación del Agente IA o de un workflow no cuenta. Qué dice ese mensaje («Confirmo
  de recibido ✅», varía mucho) lo juzga el modelo; el código solo revisa quién habló y en qué orden. Sin eso, el Agente
  IA lleva al contacto **a lo más a Cerca de compra** (`allowedAgentStage`, sigue al papel, no a la clave).
- **Agente IA que contesta** (`run.ts` + `executeActions`): si pide Compra sin vendedor, va a Cerca de compra y, si el
  cliente mandó el comprobante en ese mensaje, deja **«Depósito recibido»** aunque el contacto ya estuviera en Cerca de
  compra (tarjeta amarilla: el vendedor revisa y confirma). El traspaso Modelo 1 → Modelo 2 también usa la etapa
  permitida (el contexto dice «pasa a Cerca de compra», no a Compra). No deja aviso «acción no ejecutada» (no es una
  falla: es la regla).
- **Agente IA en segundo plano** (`lector.ts`): mismo freno; en `ai_usage.error` queda «descartado: etapa compra: falta
  que un vendedor confirme el pago en el chat…». Cuando el vendedor contesta, el chat se mueve y el siguiente barrido
  (3 min sin mensajes, 15 máx.) lo pasa a Compra.
- **Instrucciones:** la línea de la etapa con papel Venta cerrada lleva una regla fija del CRM además de la editable
  (`VENTA_CERRADA_RULE` en `lib/contacts/stages.ts`), para los dos; el lector la tiene también en su campo «etapa». El
  «anticipo o total» vive en la regla editable de la columna (Agente IA › Etapas), no en el código.
- **Goal:** sus bloques «ETAPAS DEL EMBUDO» y «COMPROBANTES DE PAGO» todavía dicen «Cerca de compra si es anticipo» y
  piden confirmar el pago al cliente; el código manda igual, pero el texto del Goal se cambia solo con OK del dueño.
- **Teóricos:** (1) si el cliente manda otra imagen después de la confirmación del vendedor y antes de que lea el Agente
  IA en segundo plano, Compra espera al siguiente mensaje del vendedor. (2) Si alguien crea un workflow «al entrar a
  Cerca de compra», un comprobante con el contacto aún en Interesado lo dispararía al quedar en Cerca de compra (el 2-oct
  no hay ningún workflow por etapa en producción).

## Caché de 1 hora y renovación en horario laboral (2-oct-2026, sin migración)

**Por qué (medido en producción, 30-sep 00:00 → 2-oct 16:41 Mazatlán):** Sonnet 5 gastó US$7.80 en 310
respuestas (~US$3.0/día). El 66 % fue **escribir la caché**: cada respuesta manda ~19 mil tokens (herramientas
+ Goal + FAQs + sufijo, iguales para todos los chats) y la caché de 5 min se vencía cuando pasaban más de 5 min
entre respuestas (101 de 310). Cada una de esas costaba ~US$0.048, contra ~US$0.011 con la caché viva.

**Qué cambió (decisión del dueño):**
- Las dos marcas de caché de Anthropic (system y historial) usan **`ttl: "1h"`**
  (`lib/ai/providers/anthropic-cache.ts`, `ANTHROPIC_CACHE_CONTROL`). Anthropic solo ofrece 5 min o 1 h; leer
  la caché reinicia su reloj sin costo.
- **Renovación de 7:00 a 22:00 (Mazatlán):** en el barrido de cada minuto del worker
  (`lib/ai/runtime/cache-keepalive.ts`, regla en `cache-keepalive-core.ts`), si la última llamada que tocó la
  caché de un modelo de Anthropic (Modelo 1 o 2) empezó hace 50–58 min, se manda una petición mínima con el
  MISMO system (`brain-system.ts`, el mismo armado que `run.ts`) y las mismas herramientas, 1 token de salida:
  solo LEE la caché (~US$0.004). Nunca escribe una caché vencida ni renueva fuera de horario; un solo intento
  por cada vez que se tocó (si falla o no la encuentra, espera a la siguiente respuesta real). El Agente IA
  contesta igual a cualquier hora.
- Registro: `ai_usage` etapa `cerebro`, resultado `cache_renovada`, sin conversación ni mensaje (no cuenta
  como respuesta; el costo estimado del selector de modelos la excluye).
- Costo: la escritura de 1 h cuesta **2× la entrada** (la de 5 min, 1.25×). `computeCostUsd` la separa con
  `usage.cache_creation.ephemeral_1h_input_tokens` del uso crudo de Anthropic (`ModelUsage.cacheWrite1hTokens`),
  así el registro del CRM sigue cuadrando con la consola.

**Estimado con las mismas 310 respuestas:** ~US$1.5/día en vez de ~US$3.0 (−51 %); la caché de 1 h sola da
−47 % y la renovación en horario suma ~US$0.13/día de ahorro.

**Ojo:** el prefijo compartido es igual en todos los chats salvo cuando cambia la lista de herramientas de un
chat (p. ej. la Tabla ya llegó a su «Máximo por chat» y su herramienta se quita): ese chat no usa la caché
común.

## Pregunta sin contestar: no se repite la misma pregunta (3-oct-2026, sin migración)

- **Falla (prod, 30-sep → 3-oct):** el cliente no contestaba la pregunta (casi siempre «¿Usted tiene problemas de
  inundaciones?» del final de «Información» o «Precio 2») y preguntaba otra cosa («¿En dónde están ubicados?»). El
  Agente IA contestaba su duda y volvía a hacer la MISMA pregunta, palabra por palabra: 44 veces en 40 chats (7–10 %
  de los chats atendidos al día), con Luna y con Sonnet 5. Causa: el Goal dice en seis lugares «continúa con la
  siguiente pregunta pendiente» y, si el cliente no contestó, la pendiente seguía siendo la misma; el candado
  anti-repetición solo compara contra lo que salió DESPUÉS del último mensaje del cliente.
- **Candado** (`lib/ai/runtime/unanswered.ts`, `lastQuestionAsked` en `context.ts`, aplicado en `run.ts` después del
  candado anti-repetición): la «última pregunta» es el saliente más reciente con «?» (Agente IA, workflow o vendedor;
  sin fallidos ni avisos) de las últimas **24 h**. Una burbuja del Agente IA idéntica a ese mensaje no sale; de una
  burbuja que termina con la misma pregunta final se quita solo la pregunta. Si no queda nada que mandar (el cliente
  solo dijo «Ok»), sale tal cual: nunca silencio. Queda en `ai_usage.error` («no se repitió la pregunta sin contestar»).
  Una paráfrasis u otra pregunta de la lista sí sale. No cambia a los workflows.
- **Goal** (texto aprobado por el dueño el 3-oct, con Historial): regla 3 de PRIORIDAD DE RESPUESTA ampliada («ni
  información que ya diste… Si tu pregunta anterior quedó sin contestar, sigue PREGUNTA SIN CONTESTAR») y sección
  nueva **PREGUNTA SIN CONTESTAR** en FLUJO CONVERSACIONAL: la pregunta de una automatización cuenta como «tu pregunta
  anterior»; una respuesta indirecta la contesta (sí/no, se le mete el agua, habla de su puerta o da una medida); si
  preguntó otra cosa, se contesta sin pregunta y se vuelve a ella cuando el cliente ya no tiene dudas; tiene prioridad
  sobre «continúa con la siguiente pregunta pendiente» y «no dejes la respuesta solo con el precio».

## Pregunta sin contestar, parte 2: la pregunta sola tampoco se repite (5-oct-2026, sin migración)

- **Por qué volvió a pasar (3-oct 20:21Z → 5-oct):** 3 veces, las 3 tras «Información» (termina con «¿Usted tiene
  problemas de inundaciones?»): el cliente volvió a escribir «Quiero más información» (2) o contestó indirecto («ha
  estado lloviendo mucho») y el modelo respondió SOLO la misma pregunta. El candado la dejaba salir por la regla «si no
  queda nada, sale tal cual» (nunca silencio). Antes del arreglo: 22 en 246 chats; después: esas 3 en 261. El candado
  quitó la pregunta 15 veces. Las 14 preguntas parecidas con otras palabras eran aclaraciones válidas.
- **Ahora** (`run.ts`, después de la red contra el silencio; `onlyRepeatsLastQuestion`, `isBareAck`, `repeatNote` en
  `unanswered.ts`): si la respuesta es solo la pregunta repetida (y ningún workflow suyo le manda algo), se pide otra
  respuesta con una nota (otro modelo; si no hay, el mismo). Si tampoco escribe algo distinto, no sale nada y el
  vendedor recibe el aviso amarillo `sin_respuesta` («El Agente IA solo iba a repetir la pregunta…»); sus acciones
  (Detalle, etapa, avisos) se conservan. Excepción: si el cliente solo mandó un acuse («ok», «va», «gracias», emojis,
  sticker; «sí» NO cuenta), la pregunta sí sale. `ai_usage.outcome = 'repite_pregunta'` (no final) marca la respuesta
  descartada. Costo: una llamada extra solo en estos casos (~1–2 al día).
- **Goal** (aprobado el 5-oct, con Historial): en PREGUNTA SIN CONTESTAR, «hablar de la lluvia o del agua en su casa»
  cuenta como respuesta, y si el cliente vuelve a pedir información que ya recibió se le explica algo nuevo (cómo
  funciona, cómo se instala, de qué está hecha), sin pregunta, con prioridad sobre PRIMER CONTACTO. Prueba sintética:
  solo-la-pregunta 2/6 → 0/6.

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

## Mensaje tapado y red contra el silencio (5-oct-2026, sin migración)

Revisión de 670 chats (30-sep → 5-oct): casi todas las preguntas que se quedaban sin contestar venían de dos
fallas de código, no del modelo.

- **Mensaje tapado.** WhatsApp da la hora en que el cliente ESCRIBIÓ y el mensaje llega de 2 a 40 s después. Si en
  ese hueco salía una respuesta del CRM, con la hora de WhatsApp el mensaje quedaba ANTES de la respuesta: contaba
  como contestado y el modelo lo leía como si ya se hubiera atendido (34 mensajes en el periodo, 6 chats sin
  respuesta). Ahora, para el Agente IA y el lector, un entrante vivo va después de todo saliente que ya existía
  cuando llegó (`agentAtSql` en `lib/ai/runtime/context.ts`): pendientes, orden del historial, candado
  anti-repetición, red contra el silencio, `respondeHasta` y `inboundAfter`. La Bandeja, la ventana de 24 h y el
  historial copiado del celular siguen con la hora de WhatsApp. Una ráfaga del cliente sin respuesta en medio
  conserva el orden de WhatsApp.
- **Red contra el silencio.** `sentToClientSinceLastInbound` contaba como "ya contestado" un workflow por palabra
  clave de un mensaje ANTERIOR aunque el cliente hubiera escrito después («Quiero más información» → Información, y
  luego «¿Hacen envíos?»). Ahora solo cuenta el workflow del ÚLTIMO mensaje del cliente; si escribió después, escribe
  el otro modelo o queda el aviso `sin_respuesta`.

Pruebas: `lib/ai/runtime/mensaje-tapado.int.test.ts`.

## Respuesta que ya empezó se termina (5-oct-2026, sin migración)

Caso del 2-oct, 7:44 p.m. El Agente IA escribió dos mensajes: «…en nuestra página web o en Amazon:» y el
link. El cliente escribió «Es fácil de instalar» (su mensaje llegó 0.1 s después del 1.er mensaje) y el envío
se detuvo: el link no salió y nadie avisó. Además, la pregunta del cliente se quedó sin contestar 10 minutos:
su hora de WhatsApp era anterior al 1.er mensaje (mensaje tapado, sección anterior). Pasó 13 veces del
26-sep al 3-oct.

- Si el cliente escribe cuando ya salió el 1.er mensaje, **el resto de la respuesta sale igual**. Esos
  mensajes llevan `respondeHasta` = la hora del último mensaje que leyó el modelo (`markAnswersUntil`):
  no cuentan como respuesta a lo nuevo, que sigue pendiente y lo contesta la siguiente corrida.
  `ai_usage.error`: «terminó la respuesta (N mensaje(s)) aunque el cliente escribió en medio».
- Si lo que detiene el envío es **un vendedor** o **una pausa / el Agente IA apagado**, el resto no sale
  y queda una tarjeta con el texto que faltó («El Agente IA se detuvo tras 1 de 2 mensajes (un vendedor
  contestó)…»). Antes se perdía sin aviso.
- El barrido (y la alarma del monitor, que usa la misma consulta) ordena los entrantes con la hora del
  Agente IA (`agentAtSql`), igual que los pendientes: un mensaje tapado ya no pasa por contestado.

Pruebas: `lib/ai/runtime/run.int.test.ts` (entre burbujas y «caso 2-oct»).

## Fuera de alcance (próximos briefs)

Follow-ups (Fase C), modelos por etapa y reenvío seguro (Fase E), y los pendientes A–F de la Fase D
(`docs/fase-d-diseno.md` §11.3).

## Tamaños en el system (5-oct-2026)

Pedido del dueño: que el Agente IA no invente nada. Revisión de chats: 7 de 39 tamaños dichos en el chat salieron mal
(90 cm → M en vez de CH, 99 → G en vez de M…) aunque el Detalle mostraba el correcto. Causa: Tallas y medidas solo
alimentaba el «tamaño sugerido» del Detalle; al modelo nunca le llegó la tabla estándar, solo la de la mini que está en
el Goal, y con esa asignaba también la estándar.

- `loadBrainSystem` (`brain-system.ts`) lee `tallas_compuerta` y `buildBrainSystemWithRuntime` (`brain.ts`) agrega la
  sección **TAMAÑOS** (`sizesInstructions` en `lib/contacts/sizes.ts`) después de las FAQs y antes del sufijo del CRM:
  una línea por línea de compuerta (estándar primero), con cada tamaño y su rango en cm. Sin rangos, el system queda
  igual que antes.
- Una sola fuente: lo que se edite en Tallas y medidas le llega al agente en la siguiente respuesta (la caché del system
  se reescribe una vez). La renovación de la caché usa el mismo armado, así que sigue manteniendo viva la misma entrada.
- El Goal debe decir «usando la sección TAMAÑOS» y no traer su propia tabla (cambio del Goal aparte, con OK del dueño).

## Lada extranjera, un solo aviso «pide una persona» y silencio ante un acuse (6-oct-2026, sin migración)

Caso real (4-oct): un cliente de España (+34) fue calificado y cotizado como si fuera de México; al pedir el enlace de
tarjeta, el Agente IA dejó 4 avisos en 3 minutos y contestó 5 veces casi lo mismo a «Vale», «Vale», «Ok».

- **Lada en el contexto del CRM** (`crmContextFor`, actions.ts; `foreignLadaLine`, lib/phone.ts): si la lada del
  contacto (`contacts.phone_country_iso`) no es de México, el último turno lleva «Lada del número del cliente: España
  (+34), fuera de México.». Con lada mexicana o sin teléfono (Instagram) el contexto queda igual. Va en el contexto, no
  en el system: la caché no cambia. Qué hacer lo dice el Goal (CLIENTES EN EL EXTRANJERO).
- **Un solo aviso «El cliente pide hablar con una persona» abierto por chat** (`hasOpenHandoverRequest`, notices.ts):
  abierto = sin resolver y sin un saliente humano (CRM o celular) después de él. Mientras lo esté, los siguientes no se
  crean; el cliente sigue recibiendo su respuesta. Cuando un vendedor contesta, el próximo pedido deja aviso nuevo.
- **Silencio ante un acuse** (run.ts): si todo lo pendiente del cliente es un acuse (`isBareAck`: «ok», «vale»,
  «gracias», emoji, sticker), `[NADA_QUE_AGREGAR]` cuenta como «no contestar»: no sale nada, no se llama a otro modelo ni
  hay tarjeta (registro: «sin texto: el cliente solo confirmó o agradeció»). Fuera de un acuse (o del complemento de un
  workflow) la señal sigue siendo respuesta vacía. Cuándo escribirla lo dice el Goal (PASAR A HUMANO).

## Sin comentarios en el Detalle (6-oct-2026, sin migración)

Pedido del dueño: ningún vendedor veía la sección Comentarios del Detalle. Se quitó la sección (y sus acciones de
servidor), y el Agente IA y el lector ya no escriben ni leen comentarios: `actualizar_detalle` y la herramienta del
lector ya no tienen el campo `comentario`, y el contexto del CRM ya no trae «Comentarios que ya guardaste». Si un
modelo manda el campo, se ignora. Los 800 comentarios guardados (casi todos del Agente IA) siguen en
`contact_comentarios`; no se borran. Lo de arriba sobre comentarios (26-sep) queda como historia. Costo que se ahorra:
la salida del comentario (~30 tokens cada uno, unos 670 por semana) y hasta 5 comentarios en la entrada de cada
llamada; del orden de US$1–2 al mes. El lector, cuando el cliente cambia lo que pide y el precio nuevo nunca se dijo,
ya no deja el comentario «falta confirmar el total»: solo no manda monto.


## Lada extranjera: sin respuesta de inicio por palabra clave (6-oct-2026, sin migración)

Con un número de otro país (`contacts.phone_country_iso` ≠ MX), los workflows «Solo al inicio» por palabra clave
(«Información», «Precio 2», la Tabla) no salen (`onInboundKeyword`, lib/workflows/triggers.ts). Contesta el Agente IA
con CLIENTES EN EL EXTRANJERO del Goal: explica que solo se envía dentro de México y pregunta si tiene dirección en
México, antes de cotizar. Antes, el workflow mandaba el precio y el complemento del Agente IA (sin preguntas) borraba esa
pregunta. Los workflows sin «Solo al inicio» (p. ej. videos) siguen saliendo por su palabra clave.

## Luna sin texto: el sufijo y sin Sonnet en las etapas del Modelo 1 (8-oct-2026, sin migración)

- **Qué pasó:** del 4 al 8-oct, Sonnet escribió 80 respuestas en chats de Prospecto porque Luna contestó solo con
  acciones (red contra el silencio → «escribe el otro modelo»): US$1.73, el 39 % de lo que gastó Sonnet en esos días, y
  más caro por respuesta porque Sonnet leía el chat completo por primera vez. Desde el cambio del sufijo del 5-oct
  (12:17 Mazatlán, «texto interno», arriba) Luna se quedaba sin texto el **8.2 %** de las veces (antes 1.7 %): el sufijo
  dejó de decir que el texto va primero y Luna, con herramientas en una sola vuelta, a veces solo llamaba
  `fijar_cotizacion` / `actualizar_detalle`.
- **Capa 1, el sufijo** (`brain.ts`): «Cada respuesta lleva SIEMPRE primero tu texto para el cliente y, en la misma
  respuesta, las herramientas que hagan falta: una respuesta solo con herramientas deja al cliente sin contestar»; lo
  de no escribir nombres de herramientas, JSON ni notas sigue igual. Banco con los 70 casos REALES en que Luna se quedó
  sin texto (`notas/banco-luna-sin-texto`, 2 vueltas, llaves de staging): sufijo del 5-oct 26.4 % sin texto, sufijo
  nuevo 8.6 %; con la segunda vuelta de Luna (abajo), 2.9 %. Texto interno: 1 de 140 en cada sufijo, y el candado de
  `internal-text.ts` detiene los dos. Cambia el prefijo en caché una vez (una escritura de 1 h, centavos).
- **Capa 2, nunca Sonnet por Luna** (decisión del dueño, «por nada del mundo»): en una etapa del Modelo 1,
  `brainCandidates` devuelve SOLO el Modelo 1 (aunque falte su llave: la tarjeta dice qué falta). Respuesta vacía → se
  le pide otra vez a Luna UNA vez con `SIN_RESPUESTA_NOTE` (`run.ts`); si tampoco, tarjeta «El agente no pudo
  responder». Red contra el silencio → escribe otra vez Luna con la nota; si tampoco, aviso `sin_respuesta`. La
  pregunta sin contestar y las letras de otro alfabeto ya usaban el mismo modelo cuando no hay otro. Lo único que
  sigue llevando a Sonnet desde una etapa del Modelo 1 es el **traspaso** (Luna mueve el contacto a una etapa del
  Modelo 2). Las etapas del Modelo 2 no cambian: si Sonnet falla o se queda sin texto, contesta Luna.
- **Efecto:** si Luna (OpenAI) se cae, los chats de Inbox y Prospecto se quedan con la tarjeta en vez de contestar
  con Sonnet. Ahorro estimado: ~US$0.35 al día de Sonnet (80 respuestas en 5 días) a cambio de unas 2 llamadas más de
  Luna al día (~US$0.002).
