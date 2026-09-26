# Anuncios de Meta (clic a WhatsApp)

Bloque "ANUNCIOS DE META" (24/25-sep-2026, rama `feat/anuncios-meta`, migraciones `0035_anuncios_meta`
y `0036_anuncios_estado`, ambas idempotentes. La 0035 se llamaba `0030_anuncios_meta` —mismo contenido y
mismo `when`— y se renumeró para que número, idx del journal y snapshot coincidan; la 0030 queda vacía.
Ver docs/migraciones.md).
La mayoría de los clientes llegan por anuncios Click-to-WhatsApp (CTWA) de la cuenta publicitaria
"Diluvium" (1058203117932599, portafolio Grupo Diluvium). Objetivo: el día que se conecte el número
oficial, cada mensaje que llegue desde un anuncio entra completo, ordenado y sin un solo error.

## Qué confirmó Zernio (24-sep-2026, por escrito)

- En coexistencia, `message.received` trae el `referral` de Meta tal cual cuando el mensaje viene de
  un clic en un anuncio: en `referral` (raíz del evento) y también en `metadata.referral`.
- Campos con los nombres de Meta: `source_id` (id del anuncio), `source_type`, `source_url`,
  `headline`, `body`, `media_type`, `image_url` / `video_url` / `thumbnail_url`, `ctwa_clid` y
  `welcome_message` si Meta lo manda. `ctwa_clid` falta en una minoría de clics (sobre todo desde
  Estados de WhatsApp).
- El referral viene SOLO en el primer mensaje después del clic. Zernio guarda el primer clic en la
  conversación (`metadata.ctwa_clid`, `ctwa_source_id`, `ctwa_source_url`, `ctwa_headline`,
  `ctwa_source_type`, `ctwa_captured_at`).
- **Dónde se consulta ese clic (documentación oficial, revisada el 25-sep-2026):**
  - *Get conversation* (`GET /v1/inbox/conversations/{id}`): *"This operation currently returns only
    the `meta_ad_*` family, which covers Instagram Click-to-Direct and Facebook Messenger
    Click-to-Message. WhatsApp Click-to-WhatsApp attribution (the `ctwa_*` keys, where the ad ID is
    `ctwa_source_id`) is returned by `GET /v1/inbox/conversations` instead."*
  - *Click-to-WhatsApp Ads* (docs.zernio.com/platforms/whatsapp/ctwa, "Step 1: The click id is
    captured for you"): ejemplo exacto del objeto `metadata` de la conversación, copiado tal cual en
    `lib/messaging/__fixtures__/zernio-conversations-ctwa.json` y usado en el test.
  - *List conversations*: cada llave de `metadata` es opcional (*"read defensively"*) y
    `ctwa_captured_at` es cuándo Zernio GUARDÓ el valor (un evento automático de Meta puede refrescarlo),
    no la hora exacta del clic.
  - Verificado en vivo, solo lectura (25-sep): el filtro `accountId` del listado devuelve solo esa
    cuenta; el **sandbox no aparece** en el listado; ninguna conversación conectada tiene aún
    `metadata` (nadie ha llegado por anuncio a un número conectado). El GET de una conversación exige
    `?accountId=` y para un id inexistente responde 200 con datos vacíos.
- `image_url` / `video_url` / `thumbnail_url` son links firmados del CDN de Meta que caducan en horas
  (verificado: un link vencido responde 403 "URL signature expired").
- Su ejemplo del evento es **plano**: sin `id`, sin `message{}` y sin `sentAt`. Los webhooks reales del
  sandbox llegan **anidados** (`message: {…}`). El CRM acepta las dos formas.

## Cómo entra un mensaje de anuncio (a prueba de fallas)

1. **Webhook** (`app/api/webhooks/zernio/route.ts`): firma, guarda y encola. Id del evento: `id` del
   cuerpo → encabezado `X-Zernio-Event-Id` → derivado estable `message.received-<wamid>` (un reintento
   de Zernio cae en la misma fila). Antes, un evento sin `id` respondía 400 y se perdía.
2. **Normalización** (`lib/messaging/zernio.ts`): el formato plano se convierte al anidado; la ficha
   se lee de la raíz con respaldo en `metadata.referral` (`lib/ads/referral.ts`, guardada ORIGINAL y
   completa); sin `sentAt`, la hora del sobre y, sin ella, la de RECEPCIÓN del webhook.
3. **Ingesta** (`lib/messaging/ingest.ts` → `attributeAd`): el mensaje se guarda como siempre y, en un
   **savepoint**, se registra el clic en `ad_clicks` (ligado a contacto, conversación y mensaje). Si el
   registro falla, solo se revierte el anuncio: el mensaje entra igual y el barrido lo reintenta desde
   `messages.ad_referral`. Cada entrada mueve `conversations.ad_entry_at`. `conversations.ad_referral`
   sigue siendo el PRIMER anuncio (el Dashboard lo cuenta).
4. **Después del commit** (worker, cola `ads`, `lib/ads/worker.ts`), sin frenar nada:
   - `thumb`: **UNA miniatura chica por anuncio** (JPEG ≤ 320 px, `org/{org}/ads/meta/{adId}/miniatura.jpg`,
     `lib/ads/thumbnail.ts`), nunca por clic. Fuente: el link de la ficha del primer clic
     (`thumbnail_url` en video, `image_url` en imagen, reducida) y, si ese ya caducó, el del creativo
     que da la API. **Sin videos** (decisión del dueño, 25-sep-2026): el video se ve en Meta; lo que ya
     se había copiado al bucket en staging se queda ahí (no se borra nada).
   - `meta`: nombres y datos de Meta (ver abajo); si el anuncio aún no tiene miniatura, encola `thumb`.
   - `fallback`: entrante SIN ficha que pudo venir de un anuncio (primer entrante de la conversación,
     Zernio cambió de conversación, o etiquetas/llaves de anuncio) → primer clic guardado por Zernio
     en la conversación (listado por cuenta, ver arriba). Solo se acepta si se capturó entre 24 h antes y
     1 h después del mensaje. **Durable:** nace "pendiente" en la base con el mensaje; la primera
     consulta es a los 30 s; `sin_datos` se reintenta 3 veces (cada 3 min) y `error` 8 (cada 5 min).
     Siempre deja registro en `messages.metadata.anuncioRespaldo` y en el log `[anuncios]`.
   - **Cuántas páginas del listado se revisan** (25-sep-2026). Fuente: docs.zernio.com/messages/list-inbox-conversations
     y el OpenAPI público (zernio.com/openapi.yaml, v1.96.0): `sortOrder` *"Sort order by updated time"*,
     `desc` por omisión; `limit` de 1 a 100 (50 por omisión); paginación por `cursor` (`pagination.hasMore`,
     `pagination.nextCursor`); cada elemento trae `updatedTime` (fecha-hora); solo filtros `profileId`,
     `platform`, `status` y `accountId` (ni hora, ni teléfono, ni id); si una cuenta falla, sale en
     `meta.failedAccounts`. Límite general: 60 solicitudes/min con 0–2 cuentas conectadas
     (docs.zernio.com/guides/rate-limits).
     Antes se revisaban 3 páginas fijas de 100. Con ~400 clientes nuevos al día más las conversaciones
     activas (cada respuesta del vendedor o del agente también la sube), durante los reintentos (hasta
     ~40 min en `error`) más de 300 conversaciones pueden actualizarse después del mensaje: **no estaba
     garantizado**. Ahora el CRM pasa la hora del mensaje y sigue página por página hasta que una ya es
     anterior a esa hora (−5 min de holgura): la conversación del mensaje se actualizó con él, así que no
     puede estar más abajo. Casi siempre basta 1 llamada (antes 3 por intento sin datos). Tope: 10 páginas
     (1,000 conversaciones); llegar al tope sin pasar la hora, o `meta.accountsFailed` > 0, es `error` (se
     reintenta), nunca "sin datos". Sin `updatedTime` legible, vuelve a las 3 páginas fijas.
     Supuesto (no documentado explícitamente por Zernio): un mensaje entrante actualiza `updatedTime` (la
     conversación sube). Lo respalda su nota de que el historial reproducido conserva su `lastMessageAt` y
     por eso "sort into date order". Se confirma con `npm run ads:probe` el día del número real.
   - Barrido cada minuto: clics sin registrar, respaldos pendientes, miniaturas pendientes y nombres
     de Meta vencidos.
5. **Agente IA**: no cambia nada (no se tocó `lib/ai/runtime`). Luna limpia la ficha y el cerebro recibe
   solo lo que escribió el cliente.

## Nombres desde Meta (API de Marketing)

- `lib/ads/meta-api.ts`: `GET /{ad_id}` (nombre, estado, cuenta, conjunto, campaña, creativo) →
  `GET /{creative_id}` (título, texto, llamada a la acción, enlace, imagen, miniatura de 320 px, id del
  video, publicación) → `GET /{video_id}?fields=title,length,picture` (solo DATOS del video; el archivo
  no se descarga). Se guarda todo: columnas de `meta_ads` + respuestas crudas (`meta_raw`) + enlaces
  "Ver en Meta" (`ads_manager_url`) y "Ver publicación" (`post_url`). Graph API **v26.0** (vigente desde
  el 29-jul-2026), cambiable con `META_GRAPH_API_VERSION`.
- Caché por anuncio en `meta_ads`; se refresca si tiene más de 24 h. Si Meta falla o falta el token se
  guarda el error y se reintenta con espera (10 min sin token, 1 h por límite de uso, 6 h por permisos,
  exponencial en lo demás). La UI muestra lo que haya (el titular de la ficha).
- **Token:** `META_ADS_ACCESS_TOKEN` — usuario del sistema del Business Manager (rol Empleado) con
  **solo `ads_read`**, la cuenta publicitaria "Diluvium" asignada con "Ver rendimiento" y la app
  "CRM Diluvium" asignada; caducidad "Nunca". Va en el encabezado `Authorization`, nunca en la URL.
  Se pone a mano en el web `crm-diluvium` (staging y production) y el worker lo referencia
  (`${{crm-diluvium.META_ADS_ACCESS_TOKEN}}`; en production el worker es `worker-production`).
  Opcional: `META_APP_SECRET` solo si la app exige `appsecret_proof`.

## Interfaz

- **Chat** (Bandeja y pop-up del Embudo): tarjeta compacta de 1–2 líneas (miniatura del bucket,
  "📣 Llegó por anuncio" y el nombre del anuncio), toda clicable → página del anuncio. Nunca la ficha.
  Junto al aviso de 24 h: "Responde antes de X: 72 h gratis" o "Gratis por anuncio hasta X".
- **Sidebar "Anuncios"** (`/anuncios`, todos los miembros): la tabla de `components/anuncios/ads-table.tsx`
  (diseño de Pulido UI, contrato en docs/ui-anuncios-tabla.md) con datos de `listAdsForPeriod`
  (`lib/ads/queries.ts`) y el filtro de periodo del Dashboard (por omisión, el mes en curso). Reglas de
  conteo (las mismas que usará "Métricas de anuncios"):
  - **Clientes** = contactos DISTINTOS con al menos un clic de ese anuncio cuya fecha (`ad_clicks.clicked_at`,
    día local de Mazatlán) cae en el periodo. Volver por el mismo anuncio cuenta una vez.
  - **Compraron** = de esos, los que HOY están en la etapa Compra. **Conversión** = compraron ÷ clientes
    ("—" sin clientes). **Clics en el enlace** = "—" hasta Métricas de anuncios (Insights de Meta).
  - **Un contacto que llegó por 2 anuncios cuenta en AMBOS** (cada anuncio lo trajo): la suma de la
    columna Clientes puede pasar del total de contactos del periodo. Un contacto sin anuncio no aparece.
  - Canales de prueba (`channels.is_test`) y contactos de prueba (`contacts.es_prueba`) no cuentan
    (igual que el Dashboard).
  - **Estado Activa/Pausada**: lo pide el worker a Meta **cada hora** (programador de BullMQ `ads-status-hourly`,
    `GET /?ids=…&fields=effective_status` de a 50, mismo token `ads_read`; si un id no existe, ese lote va
    uno por uno) y lo guarda en `meta_ads.effective_status` + `status_checked_at` (también la consulta
    completa de cada 24 h). `ACTIVE` = Activa; cualquier otro estado = Pausada. Sin lectura buena en
    90 min (Meta falló, sin token) → "—". El filtro "Activas" esconde solo las pausadas: las de "—" se
    quedan a la vista, así una falla de Meta no vacía la tabla.
  - Rendimiento: una consulta agregada por periodo (tope 2,000 anuncios); la tabla se virtualiza desde
    100 filas.
- **Página del anuncio** (`/anuncios/{id}`; una ficha sin id tiene su propia página por huella
  `f-…` o por clic `c-…`, nunca mezclada con otras): Campaña › Conjunto › Anuncio, **la miniatura** (sin
  reproductor de video: "🎬 Anuncio de video · título · duración · se ve en Meta"), texto, llamada a la
  acción y enlace, conteos **en total** (no del periodo de la tabla; mismas reglas de conteo), "Ver en
  Meta" (Administrador de anuncios) y "Ver publicación", y la lista de clientes que llegaron **por
  páginas de 50** (`?pagina=`), el más reciente primero. Un anuncio con solo clics de prueba abre igual
  (con 0 clientes): la tarjeta del chat de una prueba lleva ahí.
- **Detalle del contacto**: anuncio por el que llegó (enlace), resumen de Luna y "También volvió por…".
- Miniatura: `/api/ads/thumbnail/{adId}` (sesión + organización; URL firmada de 5 min). Nunca se
  muestran los links de Meta (caducan).
- La vista previa con datos de ejemplo (`/vista-previa/anuncios`) y la lista vieja de `/anuncios` se
  quitaron al conectar la tabla (25-sep-2026).

## Ventana gratis de 72 h

Regla de Meta: si el cliente llega por un anuncio CTWA y el negocio le responde dentro de 24 h, esa
respuesta abre 72 h en las que todos los mensajes del negocio (también plantillas) son gratis. El CRM
guarda la entrada (`conversations.ad_entry_at`) y calcula la ventana con la primera respuesta que sí
salió (`lib/ads/free-window.ts`). Es distinta de la ventana de 24 h (texto libre vs. cobro).

## Fase posterior: "Métricas de anuncios" (NO construida)

Misma sección, otra pestaña (`app/(app)/anuncios/layout.tsx` → `SECTION_TABS`): conjuntos, anuncios
activos, cuáles traen más clientes, gasto contra ventas (Insights de la API de Marketing sobre
`meta_ads` + `ad_clicks` + etapa del contacto). Llena la columna "Clics en el enlace" de la tabla.
**Mantener las reglas de conteo de la tabla** (sección Interfaz): clientes por fecha del clic, un
contacto con 2 anuncios cuenta en ambos (por eso NO se suman clientes entre anuncios para un total:
el total del periodo es `count(distinct contact_id)` sobre todos los clics), compraron = etapa Compra hoy,
sin prueba. Si se quiere "costo por cliente" por anuncio, el gasto de Insights se divide entre los
clientes de ESE anuncio (con la doble cuenta), y el total entre los contactos distintos.

## Oportunidades anotadas (NO construidas)

- **Conversions API vía Zernio:** `POST /v1/whatsapp/conversions` usa el `ctwa_clid` para mandar
  eventos `Lead` / `Purchase` a Meta (ventana de 7 días desde el clic). Ejemplo: al pasar la tarjeta a
  "Compra", mandar `Purchase` con valor en MXN para que Meta optimice hacia quien compra. Requiere
  el dataset (`POST /v1/whatsapp/dataset`, una vez por WABA). `ad_clicks.ctwa_clid` ya se guarda.
- **`whatsapp.automatic_event`:** si se activan los eventos automáticos de Meta al conectar el número,
  Zernio los reenvía; podrían registrar compras/leads detectados por Meta.
- **Instagram y Messenger** (canales futuros): referral en `metadata.referral` con `ad_id`, `source`
  "ADS", `type` "OPEN_THREAD", `ref` y `ads_context_data` (ad_title, photo_url o video_url, post_id);
  sin `ctwa_clid`. Un clic que abre un hilo existente sin mensaje llega como evento aparte,
  `referral.received`. `normalizeReferral` ya entiende esa forma; falta procesar esos canales/eventos.

## Simulación (staging, 24-sep-2026)

Script en el scratchpad de la sesión (`sim-anuncios.mjs`), corrido con
`railway run -e staging -s crm-diluvium -- node sim-anuncios.mjs <salida>`: webhooks firmados con el
formato de Zernio y ids de anuncios reales de las campañas activas, sobre un canal de simulación
(`ch_sim_anuncios`, cuenta ficticia `sim_anuncios_meta` que Zernio rechaza: ninguna respuesta del
agente sale a nadie). Resultados en el reporte del bloque.

## Mensaje opcional para el soporte de Zernio

La documentación trae el ejemplo del objeto `metadata` y dice qué endpoint lo devuelve, así que el
respaldo ya está ajustado a la forma oficial. Si se quiere una confirmación con un caso real (sin datos
de clientes), este es el mensaje (lo manda el dueño):

> Hola, equipo de Zernio. En coexistencia con WhatsApp, para una conversación que empezó por un anuncio
> Click-to-WhatsApp, ¿nos pueden compartir un JSON real de ejemplo (con datos anonimizados) de un
> elemento de `GET /v1/inbox/conversations?accountId=…` que traiga `metadata.ctwa_*`? Queremos confirmar
> que (1) el GET de una sola conversación no devuelve los `ctwa_*` (su documentación dice que solo
> `meta_ad_*`) y (2) no hay forma de pedir esa `metadata` para un `conversationId` sin recorrer el listado.
> Gracias.

## Checklist del día del número real (anuncios)

1. `ZERNIO_ALLOWED_ACCOUNT_IDS` de production incluye el accountId del número real (sin él, los
   eventos quedan en cuarentena; nada se pierde, se liberan con el replay).
2. `META_ADS_ACCESS_TOKEN` en el web de production y referenciado en `worker-production`.
2b. Al entrar Anuncios a main: aplicar el candado de migraciones en production (preparado el 25-sep, SIN
   aplicar: `~/Documents/Diluvium CRM/notas/anuncios-predeploy-produccion/aplicar.py`, ver
   docs/migraciones.md).
3. En WhatsApp Business (Meta), "atribución de anuncios" activada: sin eso Meta no manda el `referral`.
4. Tras el primer clic real en un anuncio (solo lectura):
   - `select event, payload ? 'referral' en_raiz, payload->'metadata' ? 'referral' en_metadata,
     payload ? 'message' anidado from webhook_events where payload::text like '%"referral"%' order by
     received_at desc limit 5;` → confirma la forma real (plana o anidada) y dónde vino la ficha.
   - `select origin, ad_id, ctwa_clid is not null, clicked_at from ad_clicks order by created_at desc limit 5;`
   - `railway run -e production -s crm-diluvium -- npm run ads:probe -- --account <accountId real>
     --conversation <conversationId>` → confirma que el listado de Zernio trae `metadata.ctwa_*` (es el
     respaldo sin ficha). Solo imprime conteos y nombres de llaves.
5. En la Bandeja: tarjeta "📣 Llegó por anuncio" con nombre y miniatura; página del anuncio con
   campaña › conjunto; Detalle del contacto con el enlace.
6. Log del worker `[anuncios]` durante 24 h: sin `falló` repetidos; `respaldo … sin_datos` es normal
   para quien escribe sin anuncio.

## Hallazgos para la revisión del agente (B, diagnóstico en solo lectura, 25-sep-2026)

**Síntoma (simulación en staging, 24-sep):** con la cuenta ficticia, Zernio rechaza cada envío (400) y
el agente generó **3 respuestas distintas por mensaje** (16:56:52, 16:57:10, 16:57:44): cada una es una
llamada nueva al modelo y una fila más "fallida" en el hilo.

**Dónde vive el reintento** (main `a58ebf7`, ya con la Fase E parte 2):
- Cola BullMQ **`agent-replies`** (`lib/ai/runtime/queue.ts`, `agentQueue()`): `attempts: 3`,
  `backoff: { type: "exponential", delay: 15_000 }` → reintentos a +15 s y +30 s.
- Consumer: `startAgentRuntime` (`lib/ai/runtime/worker.ts`) → `processAgentJob`
  (`lib/ai/runtime/process.ts`) → **`runAgent`** (`lib/ai/runtime/run.ts`). `runAgent` arma el historial,
  **llama al modelo** y manda las burbujas con `deps.sendBubble` = `sendTextMessage`
  (`lib/messaging/send.ts`).
- `sendTextMessage` → `deliver()` (`lib/messaging/send.ts`, ~l. 455): un **rechazo 4xx** marca el mensaje
  `failed` y **relanza** el error; un resultado **desconocido** (5xx, sin respuesta) lo deja pendiente y
  devuelve `status: "pending"` (no relanza).
- En `runAgent`, bucle de envío (~l. 483–497): si el primer envío lanza (`sent === 0`), cierra el plan
  como obsoleto y hace **`throw error`**. El job falla y BullMQ lo corre **desde cero**: vuelve a llamar
  al modelo (texto nuevo) y a intentar el envío. Por eso 3 generaciones.
- La Fase E parte 2 ya quitó esto para fallas **del modelo** (tarjeta "El agente no pudo responder", sin
  relanzar), pero **no para fallas del envío**: el `throw error` del bucle de envío sigue.
- 5xx / sin respuesta: no se regenera ni se reenvía; queda "pendiente" → `expireUnconfirmedSends` lo da
  por no confirmado → aviso al vendedor (`noticeFailedAgentSends`). El texto no se reintenta.

**Lo que dice Zernio sobre confirmar un envío dudoso** (guía oficial *Idempotency & Safe Retries*):
*"only a successful (`2xx`) response is stored for replay: a first attempt that fails releases the key"*
y *"After an ambiguous failure (a `5xx` or a network timeout) the platform may already have accepted the
message, and a failure after that point releases the key as well, so reconcile before you retry: list
the conversation's messages … and treat an empty result as inconclusive rather than as proof nothing was
sent."* O sea: la llave de idempotencia (el CRM ya manda `Idempotency-Key` = id del mensaje) solo cubre
"salió y se perdió la respuesta 2xx"; tras un 5xx/timeout, listar los mensajes de la conversación puede
**confirmar que sí salió**, pero **no puede probar que no salió**. Esto hay que decidirlo antes de
programar el punto 4 de fix/agente-reenvio.

**Plan acordado (NO construido; rama fix/agente-reenvio cuando lo indique el dueño):** generar una sola
vez por lote y guardar antes de enviar; reintentar el MISMO texto; 4xx sin reintento (⚠ + "Reintentar" +
aviso 🤖, sin pausar); 5xx/timeout con espera y conciliación previa; tests 400/500/timeout; prueba en el
canal de simulación de staging (`ch_sim_anuncios`, cuenta ficticia `sim_anuncios_meta`, agente apagado
salvo durante la prueba).
