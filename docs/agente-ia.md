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
    cada 100 conversaciones y en gris si falta su llave, y **qué modelo atiende cada etapa**
    del Embudo ("Modelo 1 | Modelo 2" por etapa; se usa la etapa del contacto al responder).
    La sección **Empresa** se quitó el 25-sep (el Goal ya dice quién es la empresa;
    `{{empresa.nombre}}` sale de `ai_config.company_name` o, si no hay, del nombre de la
    organización). Editor grande del **Goal** con
    deshacer, contador de palabras, tokens aproximados y **Valores personalizados**
    (`{{contacto.nombre}}`, `{{vendedor.nombre}}` = asignado o "un asesor",
    `{{empresa.nombre}}`, `{{agente.nombre}}`; el runtime los sustituye por conversación);
    **base de conocimiento** (FAQs: agregar, editar, activar/desactivar, borrar). Cada
    guardado del Goal o cambio de FAQs deja una **versión** (`ai_knowledge_versions`) y se
    puede **restaurar** cualquiera (la primera vez guarda también la anterior).
  - **Canales** (antes «Implementar»): los canales con interruptor Encendido / Apagado. Desde el
    28-sep-2026 solo los **no archivados** (hoy solo «WhatsApp Diluvium»); el Sandbox y el Número
    de prueba archivados se **ocultan, no se borran** (sus chats, mensajes y contactos siguen igual).
    El texto de ayuda dice «se reactiva con «Activar»» (el botón del Detalle).
  - **Historial** (Bloque A, 28-sep-2026; `?seccion=historial`, todos los roles): una fila por
    cambio con **quién**, **qué**, **antes → después** y **fecha y hora de Mazatlán**, lo más nuevo
    arriba (200 filas; con fechas se ve más atrás). Filtros: **Tipo** (Opciones del bot · Goal y
    FAQs · Modelos · Etapas · Canales · Workflows · Pausas por chat), **Desde / Hasta** (días de
    Mazatlán) y **«Mostrar pausas automáticas («un vendedor contestó»)»** (ocultas de fábrica).
    Fuentes (`lib/historial/queries.ts`): **Opciones** = `ai_config_changes` (ya existía);
    **Goal y FAQs** = `ai_knowledge_versions` (antes → después = palabras del Goal o número de
    preguntas contra la versión anterior; sin autor = «Versión … guardada por el sistema»); lo demás
    = tabla nueva **`change_history`** (migración **0042**, append-only, con `organization_id`),
    escrita en la **misma transacción** que el cambio (`lib/historial/log.ts`):
    Modelo 1 y 2 (nombre del modelo) · etapas: crear, renombrar, borrar (a qué etapa pasaron sus
    contactos), reordenar (orden completo antes → después), papel y modelo (la regla del bot y el
    color **no** se registran) · canal encendido/apagado · workflows: crear (también «Restaurar
    predeterminados»), editar (solo lo que cambió: nombre, encendido, pasos, palabras clave,
    comando, etapa, «lo usa el agente», descripción), encender, apagar y borrar · por chat:
    «Pausar agente» (y «Apagar» de la tarjeta de error) y «Activar» **con quién**, y la pausa
    automática **«un vendedor contestó»** (quién = «Automático»). La pausa por **tope de
    respuestas** o por **pedir un asesor** y el regreso solo al vencer la hora **no** dejan fila.
    `subject` guarda el nombre del contacto / etapa / canal / workflow en ese momento y
    `subject_id` no tiene llave foránea: la fila sobrevive aunque se borre lo que nombra.
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
se elige entre: GPT-5.6 Luna, Claude Sonnet 5, GPT-5.6 Terra, GPT-5.6 Sol, Claude Opus 5.5,
Claude Haiku 4.5, Gemini 3.8 Flash, Grok 4.6 y Qwen 3.7 Flash. Los tres últimos salen en
gris hasta que su llave esté en Railway (y no se pueden guardar sin ella). Si el Modelo 1 no
tiene llave en un entorno, contesta el Modelo 2; si un vendedor cambia la etapa mientras el
agente escribe y eso cambia de modelo, la respuesta se descarta y se regenera con el correcto.
Qwen no lee PDF: un comprobante en PDF le llega como nota de texto. Precios internos
(`lib/ai/pricing.ts`, fuentes en el archivo): Gemini 3.8 Flash 0.75 / 3.75 USD por millón
**hasta el 31-dic-2026** (se duplica en 2027), Grok 4.6 2 / 6 (desde 200 mil tokens de entrada
4 / 12), Qwen 3.7 Flash 0.03 / 0.13 (desde 32 mil 0.10 / 0.40; desde 256 mil 0.20 / 0.80): el
tramo se elige por la entrada de cada llamada. El tope de respuesta del cerebro es de 4,096 tokens; si
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
  proveedor saturado de la Fase E.
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
    freno anti-bucle, sin presupuesto diario y sin topes. El gasto lo controlan las llaves de
    OpenAI/Anthropic y el saldo del Dashboard. La migración 0025 apagó los canales que estaban
    en borrador, descartó los borradores vigentes y levantó las pausas viejas.
  - **Pausa:** SOLO cuando un vendedor contesta en la conversación (Bandeja, pop-up del Embudo,
    programado o, con el número real, la app del celular). Se reactiva solo a mano con
    "Reactivar" (Bandeja o Detalle del contacto). Nada más pausa.
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
  - **Envío sin carreras:** antes de CADA mensaje se relee el estado; si un vendedor responde,
    apagan el canal o el cliente escribe, el resto ya no sale. Un envío en camino detiene los
    siguientes y el agente no responde encima. Una respuesta de 2 mensajes guarda antes un
    **plan durable**; si el worker se reinicia a la mitad, el barrido lo concilia por
    `created_at` ≥ `resolved_at` (los dos con el reloj de Postgres): nada salió → el entrante se
    vuelve a atender; salió una parte → aviso con lo que faltó (nunca se reenvía: podría
    duplicar). Un envío fallido o sin confirmar deja un aviso por mensaje.
  - **AUTO con clientes reales (número real):** bloqueado hasta el approve de Codex del agente
    completo. En el sandbox (solo el teléfono del dueño) está autorizado.
  - **Antes de clientes reales** (no dañan a un cliente hoy; no abren ronda):
    - Sin frenos, un bucle con otro bot (dos agentes contestándose) gastaría sin límite hasta
      que alguien lo note en el Dashboard; el cliente escribiendo sin parar solo retrasa.
    - El cerebro ya no tiene la regla de no revelar sus instrucciones (no está en el Goal): un
      cliente podría pedírselas.
    - Conciliación de planes por hora de Postgres y no por id de plan en cada mensaje.
    - El barrido de avisos de envíos fallidos recorre `messages` cada minuto sin índice propio.
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
    no tenían llaves `{{…}}` al 24-sep-2026: el cerebro recibe exactamente lo mismo que antes
    hasta que alguien inserte un valor desde el editor.
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
  su respuesta; con ella, 0 de 30).
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
- Modelo que conteste SOLO con `actualizar_detalle`: sale el texto de respaldo (medido 0 de 30 con la
  descripción actual).
- `nivel_agua_texto` escrito por un vendedor llega al contexto del modelo (es un campo del Detalle, no nota).
- Si la BD cae justo en `holdForRetry`, el plan queda "enviando" y a los 10 min el barrido podría volver a
  atender el entrante con el modelo (doble falla).
- Un OGG manipulado (página dañada) se mediría más corto que su duración real (tope de 25 MB igual).
- Un reinicio entre `savePlan` y el primer envío bloquea al agente en esa conversación hasta 10 min.
- `ALTER TABLE messages ADD COLUMN` pide un candado exclusivo breve; si coincide con el respaldo diario, el
  pre-deploy falla por `lock_timeout` (5 s) sin tumbar nada y se reintenta.
- Un spammer con muchas notas de voz largas: ~US$0.03 por audio, visible en el Gasto de IA.

## Opciones del bot (26-sep-2026)

Rama `feat/opciones-bot`, migración **`0038_opciones_bot`**. Sección **"Opciones"** en la pestaña Agente IA
(hoy su propia subpestaña; la editan vendedores, admin y owner: recurso `aiConfig`). Copia las opciones de Ángela
en GHL. **Regla del dueño: los valores de fábrica son EXACTAMENTE el comportamiento anterior**; nada cambia
hasta que alguien mueva una opción. Reglas puras en `lib/agente-ia/opciones.ts`; lectura con caché en
`lib/ai/runtime/options.ts`; guardado y registro en `lib/agente-ia/opciones-store.ts`; UI en
`app/(app)/agente-ia/_components/bot-options.tsx`.

| # | Opción | Fábrica (= hoy) | En GHL | Columna de `ai_config` | Dónde aplica |
|---|---|---|---|---|---|
| 1 | Tiempo de espera antes de responder (5–60 s) | 15 s | 10 s | `response_delay_seconds` (reusada) | `debounceDelayFor` / `rescheduleDelayFor`; el tope de 60 s desde el primer mensaje nunca es menor que la espera |
| 2 | Pausar el bot cuando un vendedor contesta | Sí | Sí | `pause_on_human_reply` (reusada) | `onHumanOutbound`, compuerta y paradas antes de cada burbuja (con "No" el vendedor no pausa; el agente contesta lo que el cliente escriba después) |
| 2 | Reactivar solo después de | Nunca (a mano con «Activar») / 8 h / 24 h / N h | a mano | `human_reply_reactivate_hours` (nueva) | misma pausa que "Pausar agente": `agent_paused_until` + barrido del worker; el corte es la hora de regreso |
| 3 | Cuando el cliente pide un asesor | Avisar y seguir contestando | avisa y pausa 8 h | `handover_reactivate_hours` (reusada; la 0038 la deja nula) | tras enviar la respuesta y encolar su media (`pauseAfterHandover`), condicional: una pausa de un vendedor manda |
| 4 | Horario del bot (hora de Mazatlán) | 24/7 | 24/7 | `bot_schedule` jsonb `{days[1–7], from, to}` (nueva) | fuera de horario no se programa el job (`debounceDelayFor` → null) y la compuerta dice `fuera_de_horario` (sin pausa). **Apertura:** el barrido (`findPendingAtOpening`) toma los chats cuyo último mensaje es del cliente, sin respuesta, dentro de la ventana de 24 h y posteriores al corte, solo de organizaciones con horario y abiertas ahora, y los reparte **12 por minuto, uno cada 5 s**, sin tocar los que ya tienen job. Con horario, el barrido de huérfanos de 30 min no aplica (lo cubre el de apertura, hasta 24 h) |
| 5 | Responder imágenes | Sí | Sí | `read_images` (nueva) | con "No" no se firma la URL y el modelo ve `[imagen]` (los PDF siguen) |
| 5 | Responder notas de voz | Sí | Sí | `transcribe_audio` (nueva) | con "No" el worker deja la transcripción `omitida` (motivo visible en el chat, sin llamar a OpenAI), el agente no la espera y ve `[nota de voz]` |
| 6 | Longitud de respuesta | Balanceada | Balanceada | `response_length` (nueva) | "corta"/"detallada" = UNA línea al final del sufijo del CRM (`LENGTH_LINES`); el Goal, las FAQs y la caché no cambian |
| 6 | Máximo de mensajes por respuesta | 2 | 1 | `max_bubbles` (reusada) | `toBubbles(text, 1)` manda todo en un mensaje |
| 7 | Máximo de respuestas del bot por conversación | Sin tope | 50 | `max_replies_per_contact` (reusada) | al llegar (respuestas `ai_usage` cerebro/sent desde el último corte «Activar»/encendido): pausa hasta «Activar» + aviso 🤖 `tope_respuestas` (idempotente por entrante; `URGENT_NOTICE_KINDS` → tarjeta amarilla). Cubre un bucle con otro bot |

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

- **Datos.** Tabla `funnel_stages` por organización: clave estable, nombre, orden, papel, regla del bot y modelo (1 o
  2). La columna `color` existe pero no se usa: el dueño quitó el color el 27-sep (todas las columnas en azul). `contacts.stage` y `workflows.trigger_stage` pasan de enum a texto con llave foránea compuesta. La
  0041 siembra las 5 de siempre con las mismas claves y nombres; la regla de cada una es la del bloque "ETAPAS DEL
  EMBUDO" del Goal de producción y el modelo se copia de `ai_config.etapas_modelo_1` **vigente al migrar**. Toda
  organización nueva nace con las 5 (trigger `funnel_stages_seed_org`). `ai_config.etapas_modelo_1` queda sin uso
  (se conserva para que el web y el worker anteriores funcionen durante el despliegue; borrarla en una migración
  posterior). Volumen de prueba: 10,973 contactos con el reparto de producción, `db:deploy` en 0.6 s y conteos iguales.
- **Papeles** (uno por etapa, cada uno en exactamente una): Entrada (contactos nuevos; siempre la primera columna),
  Cerca de compra (datos bancarios y /banco) y Venta cerrada (comprobante que cuadra; Anuncios › Compraron). Cerca
  de compra va antes que Venta cerrada. Una etapa con papel se renombra, pero no se borra hasta pasar su papel.
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

## Fuera de alcance (próximos briefs)

Follow-ups (Fase C), modelos por etapa y reenvío seguro (Fase E), y los pendientes A–F de la Fase D
(`docs/fase-d-diseno.md` §11.3).
