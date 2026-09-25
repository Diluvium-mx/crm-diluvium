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
  - **Crear:** **Modelos** (Fase E, 25-sep-2026): selector del **Modelo 1** (recomendado
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
  - **Implementar:** los canales con interruptor Encendido / Apagado.
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
- **Fase E (definición del dueño, 25-sep-2026):** Modelo 1 (Luna) y Modelo 2 (Sonnet 5) por etapa,
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
  Siguen: A (por verificar con "¿cómo se instalan y cuánto cuestan?") y la nota del tope diario. El panel de gasto que antes
  se anotaba aquí ya existe en el Dashboard (24-sep-2026); conciliar contra las Cost API queda como
  pendiente sin fase.

## Fuera de alcance (próximos briefs)

Follow-ups (Fase C), modelos por etapa y reenvío seguro (Fase E), y los pendientes A–F de la Fase D
(`docs/fase-d-diseno.md` §11.3).
