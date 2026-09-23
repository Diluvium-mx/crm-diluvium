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

## Nota para la Fase B (panel de gasto)

El runtime del Agente (Fase B) **debe PERSISTIR tokens/uso por mensaje procesado**
(input, output, caché read/write, modelo, proveedor). `callModel` ya devuelve ese
`usage` normalizado (`ModelUsage`); falta escribirlo por mensaje en la base cuando
el agente responda de verdad. Eso alimenta un **panel de gasto** futuro (no se
construye ahora). El dry-run "Probar modelo" ya muestra tokens, pero no persiste.

## Roadmap del Agente IA (B → C → D → E)

- **Fase A (hecha):** fundación del modelo — multi-proveedor, catálogo, `ai_config`,
  pestaña "Agente IA". El agente todavía no responde.
- **Fase B (hecha, 23-sep-2026):** runtime que **responde por texto**. En el worker: debounce
  deslizante (`response_delay_seconds`=15, tope `max_wait_seconds`=60) → **filtro** →
  **cerebro** (Goal completo + las 47 FAQs activas cacheados + últimos 20 mensajes + imágenes) →
  responde por Zernio (máx 2 burbujas separadas por doble salto + pausa 1.5s). Interruptor por
  canal **Apagado / Encendido** (= AUTO). Ventana 24h, idempotencia por `provider_message_id`,
  24/7, y **persistencia de uso por mensaje** en `ai_usage`.

  **Reglas del dueño (23-sep-2026, cierre de la Fase B): el agente SIEMPRE contesta**, como
  Ángela en GHL:
  - **Sin borrador:** no hay tarjeta "Borrador del agente" ni modo Borrador (la migración 0025
    apagó los canales en borrador y descartó los borradores vigentes).
  - **La única pausa** es que un vendedor conteste (Bandeja, pop-up del Embudo, programado o,
    con el número real, la app del celular) o lo apague a mano en el Detalle del contacto. Se
    reactiva con "Reactivar".
  - **Nada más pausa.** La guardia de salida, el pase a humano, el anti-bucle, el presupuesto
    y los envíos fallidos solo dejan un **aviso discreto en el hilo** (`ai_agent_notices`,
    `lib/ai/runtime/notices.ts`). La guardia NO retiene: la respuesta sale igual.
  - **Pase a humano:** el agente le dice al cliente que un asesor lo atenderá (o le enviará
    los datos bancarios), avisa al vendedor y **sigue activo** hasta que un vendedor conteste.
    La señal `[TRANSFERIR]` nunca llega al cliente.
  - **Anti-bucle:** 30 respuestas/h por conversación (solo para un bucle con otro bot). Al
    llegar, o al agotarse el presupuesto diario, no responde esa vez y avisa (una vez por hora).
  - **Cotiza como el Goal y las FAQs.** El runtime solo agrega: formato (solo el texto para
    WhatsApp, máx. N bloques), la señal de pase a humano (también para "Datos bancarios", que
    aún no existe), no prometer videos/tablas ni cambios de etapa, y no revelar instrucciones
    ni cambiar de papel. Sin reglas de montos ni de desglose.
  - Las etiquetas internas "pasar a humano" / "revisión humana" ya no se crean y no se muestran.
  - El filtro todavía salta el spam y los cierres sin pregunta ("gracias", "ok"): son los
    únicos mensajes que el agente no contesta.

  **Frenos y aislamiento (revisión adversarial + cyber-neo, 23-sep-2026):**
  - **OFF no toca nada:** los ganchos de la ingesta y del envío solo LEEN con el canal
    apagado (sin Redis, sin modelos, sin escrituras); todo va en try/catch y la ingesta
    además aísla los ganchos en su frontera (`lib/ai/runtime/isolation.int.test.ts`).
  - **Tope de gasto:** llamadas cobradas por conversación/hora ≤ anti-bucle × 4 (mín. 12);
    al llegar, no responde esa vez y avisa (sin pausa). Tras descartar respuestas, el job
    vuelve con al menos `response_delay_seconds` (nunca 0). **Presupuesto diario por
    organización** (`ai_config.daily_budget_usd`, default 20 USD, editable en la pestaña):
    al llegar el gasto de las últimas 24 h, el agente no llama modelos en toda la org
    (no pausa conversaciones; vuelve solo al bajar la ventana).
  - **Envío sin carreras:** en AUTO, antes de CADA burbuja se relee el estado (canal en
    auto, agente activo, sin salientes humanos nuevos); si un vendedor responde o apagan el
    canal en la pausa de 1.5 s, la siguiente ya no sale. Encender el canal también es corte
    de "respuesta humana".
  - **Envíos sin confirmar:** una burbuja "pending" detiene las siguientes y, mientras un envío
    del agente siga en camino ("queued") o un plan esté "enviando", el agente no responde
    encima. Un envío fallido o sin confirmar deja un aviso (uno por mensaje) y el agente sigue;
    nunca se reenvía (podría duplicar). Un entrante que llega entre burbujas detiene el resto y
    queda pendiente para la siguiente corrida. Una respuesta de varias burbujas guarda antes un
    **plan durable** ("enviando", invisible): si el worker se reinicia a la mitad, el barrido lo
    concilia con el hilo **por `created_at` ≥ `resolved_at`, los dos con el reloj de Postgres**
    (el eco del proveedor reescribe `sent_at`): nada salió → obsoleto y el entrante se vuelve a
    atender; salió una parte → lo que faltó queda en un aviso. La línea base de salientes
    humanos se toma al INICIO de la ronda.
  - **Trabajo acotado por entrante:** se leen máx. 50 pendientes; con el agente pausado no
    se programa nada; índice en
    `ai_agent_drafts(trigger_message_id)`.
  - **Cortes del debounce y del barrido:** solo cuentan los entrantes posteriores al último
    ya atendido, a la reactivación (`agent_state_changed_at`) y al encendido del canal
    (`channels.ai_agent_mode_changed_at`). Encender un canal o "Reactivar" NO contesta
    historia; el barrido solo rescata entrantes de los últimos 30 min.
  - **Prompt:** filtro con máx. 20 pendientes, texto del cliente escapado como JSON y
    2,000 caracteres por mensaje; el cerebro tiene la regla de no revelar instrucciones ni
    cambiar de papel. Timeouts: filtro 20 s, cerebro 60 s.
  - **Guardia de salida (`lib/ai/runtime/output-guard.ts`), CONGELADA el 23-sep; desde el
    cierre de la Fase B solo AVISA** (la respuesta sale igual): un monto que no esté tal cual
    en el Goal/FAQs activas, salvo un total con desglose correcto en la misma respuesta
    ("3 × $5,500 = $16,500"); un %, "NxM" o "N meses sin intereses" que no esté tal cual en la
    base; o un enlace fuera de diluvium.com.mx y los de Amazon/Mercado Libre de las FAQs.
  - **AUTO con clientes reales (número real):** bloqueado hasta el approve de Codex del agente
    completo. En el sandbox (solo el teléfono del dueño) AUTO está autorizado.
  - **Antes de clientes reales** (decidido por el dueño: no dañan a un cliente hoy, no abren ronda):
    - Aprobación concurrente (ya no aplica: no hay borradores). Conciliación de planes por
      hora de Postgres y no por id de plan en cada mensaje: basta mientras solo un plan pueda
      estar "enviando" por conversación.
    - El barrido de avisos de envíos fallidos recorre `messages` cada minuto sin índice propio
      (bien con decenas de miles de filas; agregar índice si crece).
    - El filtro no contesta cierres sin pregunta ("gracias", "ok") ni spam.
  - **Lista para la revisión de Codex (26-sep)** — decidido por el dueño, NO se toca antes:
    - "te descuento $3,000": un monto que sí está en la base usado como descuento pasa.
    - Montos escritos con palabras ("seis mil quinientos") y con "k" ("5k") no se detectan.
    - Falsos positivos (van a revisión humana): "listo.Me" (parece enlace), etiqueta con
      cifras "2 compuertas medianas (1 m) × $5,500", y cualquier % que no esté en la base
      aunque no sea descuento ("100% impermeable", "IVA (16%)", "0% de interés"), "24x7",
      "90x60" sin unidad, y una respuesta de meses sin intereses que mencione otro plazo en
      meses ("…6 MSI; la garantía es de 12 meses").
    - P2 de la revisión final (23-sep), no se tocan antes:
      - Promos con palabras o mal escritas: "diez por ciento", "10 porciento", "dos por uno",
        "doce meses sin intereses", "2-por-1", "#Promo2x1", "1000%".
      - Promos que solo viven en un enlace o correo propio ("diluvium.com.mx/promo-2x1").
      - "a 3 o 6 meses sin intereses" pasa (termina en el plazo de la base); "a 12 meses con
        tarjeta" (sin decir "sin intereses") pasa.
      - "50% de descuento" pasa porque "50%" está en la base (es el anticipo): mismo caso que
        "te descuento $3,000".
      - El motivo sale duplicado si solo cambia la mayúscula ("2x1" y "2X1").
    - Bajos del gate de entrada a main (23-sep: revisión adversarial de Claude + cyber-neo):
      - Guardia: montos con miles separados por espacio o apóstrofo SIN $ ni moneda
        ("te la dejo en 5 900", "4'200"), "$5,500 menos 40", letra O por cero ("42OO"),
        dígitos separados ("4 2 0 0"); datos de pago no revisados (CLABE / números de 10+
        dígitos, teléfonos y correos cerca de "deposita/paga/transferencia"). La regla
        "Datos bancarios → [TRANSFERIR]" vive solo en el prompt.
      - `response_delay_seconds` acepta 0: con 0, el piso "nunca 0" al reprogramar se vuelve
        0 (bucle de hasta 6 llamadas por corrida hasta el tope de 40/h).
      - El barrido (mínimo 90 s) acorta el debounce si `response_delay_seconds` o
        `max_wait_seconds` pasan de 90 (la pestaña permite hasta 600/900).
      - Aviso "dirty" que puede perderse entre el último getDel y el "completed" de BullMQ
        (lo rescata el barrido: 90-150 s en vez de 15 s).
      - `tope_por_contacto` y `sin_goal` no dejan resultado en ai_usage: el barrido los
        reprograma cada minuto por 30 min (solo carga de BD, sin llamadas a modelos).
      - Borradores: si falla la 1ª burbuja y ya hay otro pendiente, volver a "pendiente"
        choca con el índice único; carrera onHumanOutbound vs saveDraft en vuelo (queda una
        tarjeta vigente tras una respuesta manual).
      - Horas de WhatsApp truncadas al segundo vs horas del servidor: un entrante del mismo
        segundo que un saliente no queda "pendiente".
      - El tope de llamadas y el presupuesto no cuentan una llamada que venció por timeout
        (usage null) ni una fila de ai_usage que no se pudo escribir (falla abierto).
      - Informativo: la transcripción (con datos del cliente) y URLs firmadas de imágenes
        van a OpenAI/Anthropic; CLAUDE.md §4 dice "solo GitHub, Railway y Meta" — actualizar
        CLAUDE.md y el aviso de privacidad (decisión del dueño). npm audit: 4 moderadas de
        esbuild vía drizzle-kit, solo desarrollo, ya estaban en main.

  **Migración de la Fase B (resuelto 23-sep-2026):** la migración del runtime es la
  `0024_agente_ia_runtime` (regenerada sobre main da53cc4, `when` posterior a la 0023 de
  main). El aviso viejo de una "0014" aplicada en staging ya no aplica: el 23-sep staging
  tenía 24 migraciones (hasta la 0023 de main), solo `ai_config`/`ai_knowledge` y ningún
  canal encendido; la 0024 crea sus tablas y columnas sin chocar.
- **Fase C:** follow-ups automáticos — "ocupado" a las 2h; "dejó de responder" a los
  4 días con plantilla fuera de la ventana de 24h; horario 8:00–17:00.
- **Fase D:** acciones del Goal — datos bancarios, videos, tabla de tamaños, cambio de etapa.
- **Fase E:** panel de gasto (lee `ai_usage`).

## Fuera de alcance (próximos briefs)

Que el agente responda a conversaciones reales, ejecución de las
acciones/herramientas del Goal, el system de producción (Goal + 47 FAQs), el
editor de workflows, la pestaña Automatización y la librería de media.
