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

## Fuera de alcance (próximos briefs)

Que el agente responda a conversaciones reales, ejecución de las
acciones/herramientas del Goal, el system de producción (Goal + 47 FAQs), el
editor de workflows, la pestaña Automatización y la librería de media.
