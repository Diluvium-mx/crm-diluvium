# Canal Instagram (DMs)

> Decisión del dueño (2-oct-2026): Instagram entra a v1 (CLAUDE.md §2, punto 9). TikTok queda para
> después. Este documento es la referencia del canal: reglas, cómo funciona y cómo se conecta.

## 1. Decisiones

| Tema | Decisión |
|---|---|
| Proveedor | **Zernio**, el mismo de WhatsApp (sin servicio nuevo). Conexión con *Instagram Login* y solo el permiso de mensajes (`scopes=messaging` → `instagram_business_basic` + `instagram_business_manage_messages`). |
| GHL | Desconectado de Instagram y Facebook el 2-oct-2026 (verificado en Integraciones de la subcuenta). Con dos apps conectadas Meta manda los mensajes a las dos y las dos pueden contestar. |
| Contacto | El cliente de Instagram es un **contacto aparte**: se identifica por su id de Instagram (IGSID, `contacts.instagram_id`, único por organización) y se muestra su @usuario (`contacts.instagram_username`). Sin teléfono. **No hay botón para unirlo** con uno de WhatsApp (son clientes distintos). |
| Agente IA | Contesta en Instagram **desde que el canal se conecta** (interruptor del canal en Agente IA › Canales). |

## 2. Reglas de Meta para Instagram

- **Ventana de 24 h** (la abre cada mensaje del cliente): escribe cualquiera (vendedor, Agente IA, workflows).
- **De 24 h a 7 días**: solo **una persona** puede contestar, con la etiqueta `HUMAN_AGENT`
  (`messagingType: MESSAGE_TAG`, `messageTag: HUMAN_AGENT`). Ni el Agente IA ni los workflows automáticos
  (agente, palabra clave, etapa). Sí: el composer, «Reintentar», adjuntos del chat, el «/» del vendedor y los
  programados (los escribió un vendedor).
- **Después de 7 días**: nadie, hasta que el cliente vuelva a escribir. **No hay plantillas** ni se puede
  escribir primero.
- **Texto**: máximo **1,000 bytes** UTF-8 por mensaje (una «á» o «ñ» cuentan 2, un emoji 4).
- **Adjuntos**: imagen PNG/JPEG hasta 8 MB; video MP4/MOV/WEBM hasta 25 MB; audio AAC/M4A/WAV/MP4 hasta
  25 MB (**no** MP3 ni OGG: las notas de voz de WhatsApp no pasan); archivo **solo PDF** hasta 25 MB. URL
  pública https sin redirecciones (el CRM manda una URL firmada del bucket).
- **Archivo + texto** = dos mensajes de Meta (Zernio los manda juntos y devuelve los dos ids).
- No llegan al webhook: GIFs, stickers y fotos que se borran solas. Instagram **no** manda «entregado»
  (sí «leído»).
- Responder desde una app de terceros pasa el chat a la carpeta **General** de Instagram; el equipo puede
  seguir contestando desde la app al mismo tiempo (llega como eco).
- Meta **no cobra** por mensaje de Instagram (no hay tarifa publicada). Zernio sí mide los salientes de
  todos los canales desde el 1-oct-2026: 10,000 al mes gratis, luego US$1 por 10,000.

## 3. Cómo funciona en el CRM

**Recepción** (`lib/messaging/zernio.ts` → `ingest.ts`):
- `message.received` / `message.sent` con `account.platform = "instagram"` se procesan
  (`supportedPlatform`); el resto de redes de Zernio se registra sin procesar.
- Identidad: `conversation.participantId` (IGSID) y `participantUsername`. El IGSID es numérico y **nunca**
  se lee como teléfono. `resolveInstagramContact` busca por `instagram_id`; si no existe crea el contacto
  (`source`/`source_channel` = `instagram`, nombre del perfil o `@usuario`) y actualiza el @usuario si cambió.
- Eco: `sentVia: null` (la app de Instagram) o `"human"` (panel de Zernio) = `business_app` → pausa al
  Agente IA como un vendedor desde el celular. `"api"` u otro = `other_api`; un eco **sin** `sentVia` no
  cuenta como la app (el eco del propio CRM pausaría al agente).
- Lo compartido sin texto llega con etiqueta: «📎 Te mencionó en su historia», «📎 Compartió una
  publicación», «📎 Compartió un reel»; lo que Meta no deja ver, «📎 Instagram no deja ver este mensaje…».
- Adjuntos que llegan **sin archivo** (sin `url`): la foto o el video temporal (`ephemeral`) sale como
  «📎 Mandó una foto o video temporal; Instagram no deja verlo en el CRM…» y la tarjeta compartida
  (`template`) como «📎 Compartió una publicación…» (o el aviso de arriba si trae `noRenderableContent`).
  El mensaje se guarda sin descargar nada; antes la `url` obligatoria mandaba todo el evento a
  dead-letter (3 y 4-oct-2026).
- La foto o video temporal y lo que Meta no deja ver se guardan como texto del cliente (cuentan para la
  Bandeja y el Agente IA), pero el chat los pinta como **tarjeta** de aviso, igual que el «mensaje no
  disponible» de WhatsApp (`lib/messaging/instagram-unviewable.ts`; 6-oct-2026, también los viejos).
  El archivo se descarga al bucket al llegar (las URLs de Meta caducan).
- Anuncios (clic a Direct): la ficha `metadata.referral` se registra con `platform: "instagram"`. Sin
  respaldo por la conversación de Zernio y sin la ventana gratis de 72 h (eso es de WhatsApp).
- `channels.connected_at` va **null**: no hay historial del celular; todo lo que llega es en vivo.

**Envío** (`lib/messaging/send.ts` → `ZernioProvider`):
- `loadConversation(…, human)` aplica la regla de §2 (`canSendFreeForm` en `lib/messaging/rules.ts`) y
  `sendTarget` pasa `platform` y `humanAgentTag` (`needsHumanAgentTag`).
- Un texto de más de 1,000 bytes sale en partes (`lib/messaging/instagram-text.ts`: párrafo → renglón →
  oración → palabra) con claves `<id>`, `<id>-p2`, `<id>-p3`… Repetir el envío no duplica nada (Zernio
  guarda la respuesta de cada clave 24 h). Un pie de más de 1,000 bytes: el archivo solo y el texto en
  partes después.
- **Una burbuja por envío**: los ids de las otras partes van en `messages.metadata.partesInstagram`; sus
  ecos se reconocen en la ingesta (`isInstagramPartEcho`) y, si llegaron antes de confirmar el envío, se
  borran al enlazar (`recordInstagramParts`).
- Si la 1.ª parte falla, el envío falla como siempre. Si falla una parte posterior (que no sea 429), el
  mensaje queda **enviado** con `metadata.avisoEnvio` y la burbuja lo muestra («⚠ La parte 2 de 3 del
  texto no salió…»). Un 429 en cualquier parte repite todo el envío.
- Plantillas: `sendTemplateMessage` las rechaza en Instagram.

**Pantallas**: el encabezado, el Detalle y la tarjeta del Embudo muestran «@usuario · Instagram»
(`contactHandle`); la búsqueda de la Bandeja y del Embudo también busca por @usuario; el aviso de ventana
y el composer siguen §2 (`canSellerWrite`); 📄 no sale; 🕒 solo texto con la regla de 7 días.

**Monitoreo**: la pastilla «WhatsApp conectado» y la alarma de desconexión siguen siendo solo de WhatsApp
(`channels.type = 'whatsapp'`). La alarma «Agente IA callado» sí cuenta Instagram.

## 4. Conexión paso a paso

### 4.1 Lo que hace el dueño (una vez)
1. La cuenta de Instagram de Diluvium es **profesional (Empresa)**.
2. En Instagram › Configuración › **Herramientas conectadas** › **Permitir acceso a los mensajes**: encendido.
3. Para staging: una **cuenta de Instagram de prueba**, también profesional, con la misma opción encendida.

### 4.2 Staging (primero, CLAUDE.md §4)
1. Webhook de Zernio **solo para staging**, filtrado al perfil de pruebas: `POST /v1/webhooks/settings`
   con la URL `https://<staging>/api/webhooks/zernio`, los eventos de inbox y
   `profileIds: ["6ab6bd1783114b01d4223acc"]` («Diluvium Pruebas»). Su secreto va a
   `ZERNIO_WEBHOOK_SECRET` de staging (web), por portapapeles; nunca en el chat.
2. Enlace de conexión de la cuenta de prueba en ese perfil:
   `GET /v1/connect/instagram?profileId=6ab6bd1783114b01d4223acc&loginMethod=instagram_login&scopes=messaging`.
   El dueño inicia sesión con Instagram (Claude no mete contraseñas).
3. `GET /v1/accounts` → el `accountId` de la cuenta nueva (`platform: "instagram"`).
4. Migración 0055 en staging (pre-deploy `npm run db:deploy`) y
   `npm run canal:instagram -- --cuenta <accountId> --usuario <@prueba> --prueba --confirmar` contra la base de staging.
5. Sumar el `accountId` a `ZERNIO_ALLOWED_ACCOUNT_IDS` de staging (web y worker).
6. Encender el Agente IA en Agente IA › Canales (staging) y probar: DM nuevo, respuesta del vendedor,
   respuesta del Agente IA, texto largo, foto con pie, workflow con video, eco desde la app de Instagram,
   regla de 24 h / 7 días (moviendo `window_expires_at` en staging), mención en historia.

### 4.3 Producción (después de validar staging y con OK del dueño)
1. Merge a `main` (despliega la 0055).
2. Enlace de conexión en el perfil «Default» (`6aad9802cd1a8bb37b57dacb`) con los mismos parámetros; el
   dueño inicia sesión con la cuenta real. Es la 2.ª cuenta conectada de Zernio: gratis.
3. `accountId` → `npm run canal:instagram -- --cuenta <accountId> --usuario <@diluvium> --confirmar` en producción.
4. Sumar el `accountId` a `ZERNIO_ALLOWED_ACCOUNT_IDS` de producción. Lo que haya llegado antes está en
   cuarentena: se libera con `scripts/replay-webhook-events.ts`.
5. Encender el Agente IA en el canal (queda en el Historial).

## 5. Historial de Instagram (importado)

Al conectar, Zernio copia los últimos 500 chats (hasta 500 mensajes c/u) **sin webhooks**. Se traen con
`npm run historial:instagram -- --cuenta <accountId> [--simular]` (`lib/messaging/instagram-history.ts`,
mismo cliente que el historial de WhatsApp: 40 peticiones/min, reintentos, reanudable con Ctrl+C):
- Se guardan como **historial** (`imported_at`): sin Agente IA, workflows ni no leídos; en el chat dicen
  «Importado de Instagram». Los contactos nuevos nacen con `source = historial_instagram` (el Dashboard no los
  cuenta como conversaciones nuevas), sin teléfono, en la etapa de entrada.
- Un cliente que ya escribió en vivo: su historial se pega a SU conversación; el `mid` de Meta es el mismo en
  la API y en el webhook, así que nada se duplica.
- La **ventana** sí se calcula con el último mensaje del cliente (en Instagram es un hecho de Meta): un chat
  reciente queda contestable (24 h / 7 días).
- Adjuntos: se guarda la ruta de Zernio (`refreshUrl`, vuelve a sacar el archivo aunque la URL de Meta
  caducó); los de más de 2 semanas no se copian (se ven en la app de Instagram).
- El Agente IA en segundo plano solo lee chats con actividad de los últimos 3 días: de lo importado, solo los
  recientes (centavos).

## 6. Pendientes
- **Vigilancia de la conexión de Instagram** (token vencido → reconectar): Zernio manda
  `account.disconnected`; ver la forma real de `/v1/accounts/{id}/health` en staging antes de sumarla.
- Adjuntos del chat: Instagram solo acepta PDF como documento; hoy un Word/Excel/XML falla con el motivo
  de Meta en la burbuja (se puede validar antes de mandar).
- Capturas del mapa (Bandeja › Chat › 9, 11, 26; Mensajes › 25) con datos de ejemplo.
