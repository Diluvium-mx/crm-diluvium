# Anuncios de Meta (clic a WhatsApp)

Bloque "ANUNCIOS DE META" (24-sep-2026, rama `feat/anuncios-meta`, migración `0028_anuncios_meta`).
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
  `ctwa_source_type`, `ctwa_captured_at`), consultable con `GET /v1/inbox/conversations/{id}`.
  Verificado en vivo: exige `?accountId=` (400 sin él) y un id inexistente responde **200 con datos
  vacíos** (no 404): la ausencia de clic se lee del contenido.
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
   - `media`: copia imagen/video/miniatura al bucket (`org/{org}/ads/clicks/{clic}/{rol}`). Reintenta
     red/5xx hasta 8 veces; un 4xx (link caducado) se abandona al 3.º intento; nada tras 48 h. Otro clic
     del mismo anuncio reusa la copia.
   - `meta`: nombres de Meta (ver abajo) y luego `creative_media` (imagen/miniatura del creativo; el
     video del creativo solo si ningún clic trajo el suyo).
   - `fallback`: entrante SIN ficha que pudo venir de un anuncio (primer entrante de la conversación,
     Zernio cambió de conversación, o etiquetas/llaves de anuncio) → primer clic guardado por Zernio.
     Solo se acepta si se capturó entre 24 h antes y 1 h después del mensaje (Zernio guarda el PRIMER
     clic; uno viejo no es de este mensaje). Siempre deja registro en
     `messages.metadata.anuncioRespaldo` (`atribuido`, `sin_datos`, `fuera_de_tiempo`, `ya_registrado`,
     `error`) y en el log `[anuncios]`.
   - Barrido cada minuto: clics sin registrar, media pendiente, creativos pendientes y nombres de Meta
     vencidos.
5. **Agente IA**: no cambia nada (no se tocó `lib/ai/runtime`). Luna limpia la ficha y el cerebro recibe
   solo lo que escribió el cliente.

## Nombres desde Meta (API de Marketing)

- `lib/ads/meta-api.ts`: `GET /{ad_id}` (nombre, estado, cuenta, conjunto, campaña, creativo) →
  `GET /{creative_id}` (título, texto, imagen, miniatura de 720 px, video, publicación) →
  `GET /{video_id}?fields=source,picture` (opcional: si no hay permiso sobre la página, queda la
  miniatura). Graph API **v26.0** (vigente desde el 29-jul-2026), cambiable con `META_GRAPH_API_VERSION`.
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
- **Sidebar "Anuncios"** (`/anuncios`, todos los miembros): anuncios que trajeron clientes, con
  clientes y cuántos compraron (etapa Compra).
- **Página del anuncio** (`/anuncios/{id}`; `/anuncios/sin-id` para fichas sin id): Campaña › Conjunto
  › Anuncio, video o imagen, texto, conteos, "Ver en Meta" (Administrador de anuncios) y "Ver
  publicación", y la lista de clientes que llegaron.
- **Detalle del contacto**: anuncio por el que llegó (enlace), resumen de Luna y "También volvió por…".
- Media: `/api/ads/media/{click|ad}/{id}/{rol}` (sesión + organización; URL firmada de 5 min). Nunca se
  muestran los links de Meta (caducan).

## Ventana gratis de 72 h

Regla de Meta: si el cliente llega por un anuncio CTWA y el negocio le responde dentro de 24 h, esa
respuesta abre 72 h en las que todos los mensajes del negocio (también plantillas) son gratis. El CRM
guarda la entrada (`conversations.ad_entry_at`) y calcula la ventana con la primera respuesta que sí
salió (`lib/ads/free-window.ts`). Es distinta de la ventana de 24 h (texto libre vs. cobro).

## Fase posterior: "Métricas de anuncios" (NO construida)

Misma sección, otra pestaña (`app/(app)/anuncios/layout.tsx` → `SECTION_TABS`): conjuntos, anuncios
activos, cuáles traen más clientes, gasto contra ventas (Insights de la API de Marketing sobre
`meta_ads` + `ad_clicks` + etapa del contacto).

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
