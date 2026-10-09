> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

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
