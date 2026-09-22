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
  - `providers/{openai,anthropic}.ts`: adaptadores. Agregar Google / xAI /
    OpenRouter después = **un archivo adaptador nuevo + registrarlo**; nada más
    cambia.
- **Caché del system por proveedor**: OpenAI automática (prompts ≥1024 tokens);
  Anthropic explícita con `cacheControl: { type: 'ephemeral' }` en el bloque de
  sistema. Se reporta en `usage.inputTokenDetails.cacheReadTokens` /
  `cacheWriteTokens`. Con el system de prueba (corto) marca 0 hasta que el system
  real (largo) llegue en la Fase B; el cableado y el reporte ya están listos.
- **`ai_config`** (una fila por organización): `modelo_filtro`,
  `modelo_cerebro`. Default filtro = Luna, cerebro = Sonnet 5. Editable solo
  owner/admin (ACL: recurso `aiConfig` en `lib/auth/permissions.ts`).
- **Pestaña "Agente IA"** (`/agente-ia`, solo owner/admin): selectores de filtro
  y cerebro (cada opción muestra nivel + multimodal; **en gris** si falta su
  llave o su adaptador) + botón **"Probar modelo"** (dry-run filtro→cerebro con
  la config actual, **sin tocar WhatsApp** ni conversaciones).

## Modelos (Fase A)

Filtro: **GPT-5.6 Luna**. Cerebro (default **Claude Sonnet 5**) + opciones:
GPT-5.6 Terra, Claude Haiku 4.5, Gemini 3.8 Flash, Grok 4.6, Qwen 3.7 Flash. Los
tres últimos salen en gris hasta que llegue su adaptador (brief siguiente). Los
model-id de API se verificaron contra docs oficiales / OpenRouter (2026-09).

## Llaves (Railway)

`OPENAI_API_KEY` y `ANTHROPIC_API_KEY` van en el **servicio web** (`crm-diluvium`),
en `production` y `staging` (el web las usa en el dry-run "Probar modelo"), y se
referencian desde el **worker**:

```bash
railway variable set 'OPENAI_API_KEY=${{crm-diluvium.OPENAI_API_KEY}}' -s worker -e staging
railway variable set 'ANTHROPIC_API_KEY=${{crm-diluvium.ANTHROPIC_API_KEY}}' -s worker -e staging
```

(y lo mismo con `-e production` tras validar en staging). Comillas **simples**:
zsh trata `${{...}}` como *bad substitution* con comillas dobles. Una opción del
selector cuya llave falte queda en gris automáticamente.

## Nota para la Fase B (panel de gasto)

El runtime del Agente (Fase B) **debe PERSISTIR tokens/uso por mensaje procesado**
(input, output, caché read/write, modelo, proveedor). `callModel` ya devuelve ese
`usage` normalizado (`ModelUsage`); falta escribirlo por mensaje en la base cuando
el agente responda de verdad. Eso alimenta un **panel de gasto** futuro (no se
construye ahora). El dry-run "Probar modelo" ya muestra tokens, pero no persiste.

## Roadmap del Agente IA (B → C → D → E)

- **Fase A (hecha):** fundación del modelo — multi-proveedor, catálogo, `ai_config`,
  pestaña "Agente IA". El agente todavía no responde.
- **Fase B (en curso):** runtime que **responde por texto**. En el worker: debounce
  deslizante (`response_delay_seconds`=15, tope `max_wait_seconds`=60) → **filtro** →
  **cerebro** (Goal + 47 FAQs cacheados + últimos 20 mensajes + imágenes) → responde
  por Zernio (máx 2 burbujas separadas por doble salto + pausa 1.5s). Interruptor por
  canal (off/borrador/auto). Pausas: respuesta manual del vendedor (incl. echo
  `business_app`) = pausa indefinida con **reactivación manual**; pasar-a-humano =
  etiqueta + pausa + **reactivación automática a las 8h** (`handover_reactivate_hours`);
  anti-bucle (10 respuestas/hora, configurable) = pausa + etiqueta "revisión humana".
  Ventana 24h, idempotencia por `provider_message_id`, 24/7, y **persistencia de uso por
  mensaje** en `ai_usage`. Deja campos de estado por conversación (`agent_state`,
  `paused_until`, `last_inbound_at`, `last_agent_reply_at`) para la Fase C.
- **Fase C:** follow-ups automáticos — "ocupado" a las 2h; "dejó de responder" a los
  4 días con plantilla fuera de la ventana de 24h; horario 8:00–17:00.
- **Fase D:** acciones del Goal — datos bancarios, videos, tabla de tamaños, cambio de etapa.
- **Fase E:** panel de gasto (lee `ai_usage`).

## Fuera de alcance (próximos briefs)

Que el agente responda a conversaciones reales, ejecución de las
acciones/herramientas del Goal, el system de producción (Goal + 47 FAQs), el
editor de workflows, la pestaña Automatización y la librería de media.
