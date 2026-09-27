# Bandeja: UX acordada y contrato de datos

Decidido con el dueño el 18-sep-2026. El backend (`lib/`, `app/api/`) lo hace el track P0/backend;
la UI (`app/(app)/**`, `components/**`) la hace el track UI. **Principio: mientras menos datos, mejor.**

## Dónde vive

| Sección | Qué es |
|---|---|
| **Bandeja** (menú; ruta actual `/dashboard`, el menú deja de decir "Bandeja / Embudo") | Bandeja de entrada de TODOS los mensajes: lista, chat y panel de contacto |
| **Contactos** | Tablero kanban (el embudo vive SOLO aquí). Clic en una tarjeta → abre el MISMO chat en panel lateral, con historial completo, temperatura y etapa, sin salir del tablero |

El chat es un solo componente reutilizado en las dos secciones.

## Bandeja: tres columnas

```
┌─ Lista (se cierra) ─┬──── Chat ────────────────────────┬─ Contacto (se cierra) ─┐
│ Buscar              │ Nombre · teléfono · etapa         │ Nombre, teléfono       │
│ No leído│Todo│Dest. │ Aviso ventana 24 h                │ Etapa ▾  Temperatura ▾ │
│ fila: avatar,nombre,│ burbujas + adjuntos + estado ✓✓   │ calificación, coment.  │
│ hora,vista previa,  │ tarjeta "Llegó por anuncio"       │                        │
│ no leídos, semáforo │ composer (bloqueado fuera de 24h) │                        │
└─────────────────────┴───────────────────────────────────┴────────────────────────┘
```

- **La lista (izquierda) y el panel de contacto (derecha) se abren y cierran con un botón visible.**
  El chat se queda con el espacio.

### Lista de conversaciones
- **Buscar** por nombre o teléfono.
- **Filtros (pestañas): No leído · Todo · Destacado.** "Reciente" no existe: la lista SIEMPRE va del
  último mensaje (arriba) al más antiguo.
- **Fila:** avatar (iniciales + badge de WhatsApp, reusar `contact-avatar`), nombre, hora del último
  mensaje, vista previa de una línea, número de no leídos, estrella de destacado.
  - Vista previa: si el último fue saliente, "Tú: …"; si fue adjunto, "📎 Foto / 📄 Documento / 🎤 Audio / 🎬 Video".
  - **Semáforo** (se deja para evaluar su utilidad): punto verde <15 min, ámbar <1 h, rojo >1 h,
    medido desde el mensaje del cliente que sigue SIN respuesta. Sin punto si no hay nada pendiente.
- **Destacado:** marca compartida por el equipo (todos ven todo, CLAUDE.md §5).
- Tiempo real: un mensaje nuevo sube la conversación y actualiza no leídos sin recargar.

### Chat
- **Encabezado:** nombre, teléfono, chip de etapa. Sin llamar, carpeta, correo ni borrar.
- **Ventana de 24 h:** "Ventana abierta · quedan X h". Vencida → composer bloqueado con el aviso
  "Pasaron 24 h desde su último mensaje. Solo se puede enviar una plantilla." (plantillas: con el
  número real).
- **Burbujas:** cliente a la izquierda, nuestras a la derecha, separador por día.
- **Estado del saliente:** ✓ enviado · ✓✓ entregado · ✓✓ azul leído · ⚠ falló (motivo + Reintentar).
- **Sin autor del mensaje en v1** (no mostrar quién lo envió ni "desde el celular").
- **Adjuntos:** foto (miniatura → grande), audio (reproductor), video, documento PDF/XML (tarjeta con
  nombre + descargar). Mientras se guarda en el bucket: "procesando…".
- **Anuncio de clic a WhatsApp:** tarjeta compacta "📣 Llegó por anuncio" con titular y miniatura.
  NUNCA el volcado crudo (ctwaClid, mediaUrl, …). Ver `docs/investigacion/anuncios-ctwa.md`.
- **Composer:** Enter envía, Shift+Enter salto de línea. Abrir la conversación la marca como leída.
  ⚡ **Mensajes rápidos** y "/" ("/ busca mensajes rápidos"): ver abajo.

### Panel de contacto
**Desde el Bloque B (22-sep-2026)** es el MISMO componente "Detalle del contacto" que el pop-up de
la tarjeta del Embudo (`contactos/_components/contact-details.tsx`), en este orden: nombre,
teléfono, etapa y temperatura, ¿tiene problemas de inundaciones?, ¿cuánta agua entra?, ¿cuántas
entradas?, ancho + línea + tamaño de compuerta (sugerido por rangos / manual) por entrada, monto
de cotización (MXN), % de convencimiento, [espacio para el interruptor del Agente IA, Fase B],
comentarios (autor y fecha) y, al final compactos, correo y etiquetas. Guardado automático al
salir de cada campo (sin botón Guardar) con aviso "Guardado ✓". Ya no existe "Ver ficha completa".

### Lista: temperatura (C1)
Debajo de la estrella de cada fila va la temperatura del contacto (🔥/🧊/⏳/⭐; ○ sin asignar); un
clic abre un menú para cambiarla sin abrir el chat. Lista y panel quedan sincronizados.

### Clic derecho: leído / no leído (27-sep-2026)
- **Menú del clic derecho** en la fila de la lista (Bandeja) y en la tarjeta (Embudo), en portal
  (`components/ui/context-menu.tsx`, Base UI Context Menu). Por ahora una sola opción, que alterna:
  **Marcar como no leído** / **Marcar como leído**. En táctil la fila abre con pulsación larga; la
  tarjeta del Embudo no (ahí la pulsación larga es arrastrar).
- **No leído = `unread_count` al menos 1** (sin columna nueva, como los avisos internos que ya suben
  el contador): se ve el círculo naranja, entra al filtro "No leído" y al círculo de la tarjeta. Si
  ya tenía no leídos se quedan. Se apaga como siempre: al abrir el chat, al contestar o con "Marcar
  como leído". Si después llega un mensaje, el círculo suma (2).
- **Leído = `unread_count` a 0**, también los avisos internos: lo pidió el vendedor a propósito.
- Es del equipo (como Destacado); el trigger de `conversations` avisa al SSE y todos lo ven en vivo.
- Marcar como no leído la conversación **abierta** la cierra (como WhatsApp Web): abierta, la
  siguiente llegada la volvería a marcar leída.
- **Embudo:** no leído va a la conversación más reciente del contacto (la que abre la tarjeta); leído
  apaga todas. Contacto sin chat → aviso "Este contacto todavía no tiene chat.". No cambia el tono
  de la tarjeta: el azul es "falta contestar", no "sin leer".
- Abrir un chat SIN ningún entrante del cliente (solo salientes o avisos) ahora lo deja en 0; antes
  el contador se quedaba (no había entrante que sirviera de corte).
- **Luz del cursor de la fila:** es de la fila entera (`data-glow`) y no del área que abre el chat
  (`data-no-glow`); antes se cortaba antes de la estrella y la temperatura. `glow-pointer.tsx`
  salta los `data-no-glow` para que la luz siga al cursor en la fila.

### Mensajes rápidos en el composer (27-sep-2026)
- Antes se llamaban **Fragmentos**; desde el 27-sep todo texto visible dice **Mensajes rápidos**
  (la sección, el botón ⚡ con su ventana, el menú del "/" y el texto de la caja: "/ busca mensajes
  rápidos"). La tabla y el código siguen siendo `snippets` (sin migración).
- **⚡** agrega el mensaje rápido al final del borrador; **"/"** lo busca mientras se escribe y lo pone
  en el lugar del "/" (↑↓ elige, Enter inserta, Esc cierra). Debajo del menú del "/" van los
  comandos de Automatización (/tabla, /banco…). Nada se manda solo: el vendedor revisa y envía.
- El buscador ignora acentos y mayúsculas y busca en nombre y texto (`lib/snippets/slash.ts`):
  "cuanta" encuentra "Cuánta agua entra". Solo `{{vendedor}}` se llena solo (con quien escribe).
- Los 22 de Diluvium se cargan con `npm run mensajes-rapidos:cargar` (simula; escribe con
  `--confirmar`; por nombre, sin duplicar ni tocar otros). Lista: `lib/snippets/mensajes-rapidos-diluvium.ts`.

### Programados (A6)
Van dentro del hilo, al final, como burbujas punteadas "🕒 Programado para …" con Editar/Cancelar
(fallidos: Reintentar/Descartar; cancelados solos: el cliente escribió antes o el autor ya no está
activo). El composer tiene 🕒 junto a "Enviar" (y junto a "📄 Enviar plantilla" fuera de ventana).

### Apagar bot (25-sep-2026) → "Pausar agente" (26-sep-2026)
> **Desde el 26-sep-2026 (pedido del dueño):** el control vive SOLO en "Detalle del contacto": "Pausar
> agente" (menú igual, con "Pausar indefinidamente" en vez de "Hasta que lo reactive") y, pausado,
> "Activar" (antes "Reactivar"). Se quitó del encabezado del chat; el aviso del hilo solo informa.
> Detalle: `docs/agente-ia.md` › Parte 1.

Botón "🤖 Apagar bot" en el encabezado del chat (Bandeja y pop-up del Embudo, mismo componente) y
en "Detalle del contacto", solo con el Agente IA encendido en el canal. Apaga al agente en ESA
conversación; todas las demás siguen contestando. Menú: 8 horas · 12 horas · 24 horas · Hasta una
fecha y hora (hora de Mazatlán; rechaza horas pasadas y más de 30 días) · Hasta que lo reactive. Lo
usan vendedores, admin y owner (Server Action `pauseAgent`, sin ACL, como "Reactivar").
- **Estado:** `agent_state = pausado_humano` + `agent_paused_until` = hora de regreso (null = sin
  tiempo). Sin migración. Con el bot apagado, el mismo botón dice "Cambiar hora".
- **Aviso:** "🤖 Bot apagado · vuelve hoy 22:30" (o "mañana 08:15", "sáb 26-sep 10:00", "hasta que
  lo reactives") + "Reactivar". Decisión del dueño: toda pausa es "bot apagado"; la que deja un
  vendedor al contestar desde el CRM (sin tiempo, como antes) dice "hasta que lo reactives".
- **Vuelve solo:** el barrido del worker (cada minuto) pasa a `activo` las pausas con hora cumplida,
  filtrando por organización; la Bandeja se entera por el SSE. El corte (`agent_state_changed_at`)
  es la HORA DE REGRESO prometida, no la del barrido (revisión de Codex: con "ahora", un mensaje
  escrito entre la hora y el barrido no se podía rescatar si fallaba la cola). Si el cliente escribe
  después de la hora y antes del barrido, el gancho de entrante lo reactiva en ese momento (ese
  mensaje sí se contesta).
- **Solo mensajes nuevos:** lo que el cliente ESCRIBIÓ con el bot apagado no se contesta al volver,
  aunque el webhook llegue tarde (se compara la hora de WhatsApp, `sent_at`, con el corte; aplica
  también tras "Reactivar") ni tras un reinicio del worker (el barrido de huérfanos usa la misma
  regla). Responde a partir del siguiente mensaje del cliente; como hoy, el modelo lee TODO el historial.
- **El temporizador se respeta:** si el vendedor escribe con el bot apagado por tiempo, la hora no
  cambia. Si escribe con el bot encendido (o ya cumplida la hora), se apaga sin tiempo como siempre
  (un solo UPDATE condicional: no borra una hora que otro vendedor acaba de elegir).
- Al apagarlo se cancela el job pendiente; si el agente ya estaba escribiendo, su respuesta no sale.
- El interruptor general del canal (pestaña Agente IA) no cambia.
- WhatsApp da la hora en segundos enteros: lo escrito en el MISMO segundo del corte cuenta como nuevo
  (nunca se ignora un mensaje nuevo; a lo más se contesta uno escrito <1 s antes).
- Pendientes teóricos (sin escenario hoy): un eco TARDÍO del celular del vendedor (business_app)
  escrito durante la pausa, si llega después de la hora de regreso, deja el bot apagado sin tiempo
  (Zernio no reenvía hoy los ecos de coexistencia; igual pasaba con "Reactivar"). Carreras de
  milisegundos entre el gancho de entrante y "Reactivar"/barrido. `pauseAgent` no revisa en el
  servidor el modo del canal (solo la UI oculta el botón). Sin registro de quién apagó el bot. El
  barrido lee `conversations` completa cada minuto (sin índice; ~11 k filas).

### Cambios en vivo (26-sep-2026)
Un cambio de etapa, temperatura, cotización o campos del Detalle hecho por el Agente IA, por una
automatización (`/banco` → Cerca de compra) o por otro vendedor se ve sin refrescar.
- **Evento `contact.updated`** del SSE (mismo canal `inbox_events`, siempre filtrado por
  organización): `contactId`, `contactName`, `changes` (`etapa`, `temperatura`, `cotizacion`,
  `detalle`, `comentarios`), `stage {from, to}` si cambió la etapa, `by` (vendedor con `userId` y
  nombre · `agente` · `automatizacion` con el `userId` de quien escribió el comando, o null si fue
  una palabra clave del cliente) y `at`.
- **Un solo helper**: `notifyContactUpdated` (`lib/contacts/notify-updated.ts`), llamado DENTRO de
  la transacción de cada escritura (NOTIFY sale al confirmar; si se revierte, no sale). Lo llaman
  `updateContactStage`/`updateContactTemperature` (`lib/actions/contacts.ts`), TODAS las escrituras
  de `lib/contacts/qualification.ts` (sin `by` = Agente IA: así el autollenado queda cubierto),
  `moveStageForward` (`lib/contacts/stage.ts`: agente y la regla de `/banco`) y `setQuoteByAgent`.
  Las importaciones masivas NO: siguen mandando un solo `contacts.bulk`. `replaceSizeRanges`
  (Tallas, de toda la organización) tampoco avisa por contacto: el Detalle abierto ve el tamaño
  sugerido nuevo al reabrirlo.
- **Embudo**: la tarjeta pasa sola a su nueva columna, arriba (por la hora del cambio), en lotes de
  500 ms. Si el vendedor la está arrastrando, el cambio espera a que la suelte; si la soltó en otra
  columna manda la etapa del vendedor. Mientras una escritura del propio vendedor sobre ese contacto
  está en curso, no se aplica una lectura (al terminar se relee). En cada `reload` del SSE (al
  conectarse y al reconectar) se pone al día con `getContactsChangedSince` (lo que cambió de etapa
  desde la carga o la vuelta anterior, más las temperaturas completas en pares id → temperatura,
  porque la temperatura no lleva hora; en la misma fila de peticiones; con más de 200 cambios de
  etapa, recarga completa). Si llega una recarga completa (importación), se releen los contactos cambiados en vivo
  en los últimos 2 min. La cotización NO se muestra en la tarjeta (decisión del dueño).
- **Detalle del contacto** (Bandeja y pop-up): se pone al día solo (500 ms), sin pisar el campo que
  el vendedor está tecleando ni uno con su guardado en curso (`lib/autosave/tracked-saves.ts`); lo
  saltado se relee en cuanto ese guardado termina. Al salir del campo que tecleaba, lo del vendedor
  se guarda (manda). La Bandeja relee etapa y temperatura del
  chat abierto y la temperatura de las filas de ese contacto.
- **Aviso emergente** (`app/(app)/_components/stage-change-toasts.tsx`, en el layout: todas las
  secciones): baja debajo de la barra de arriba, 10 s, con X, `aria-live="polite"`. Solo cambios de
  ETAPA hechos por otro ("🤖 Agente IA movió a Juan Pérez a Interesado", "⚙️ Automatización movió
  a …", "Daniel movió a …"); nunca el del mismo usuario (tampoco su `/banco`). Máximo 3; con más en
  esos 10 s se juntan en uno ("5 contactos cambiaron de etapa"). Clic: su chat en la Bandeja
  (`/dashboard?contacto=<id>`; sin chat, su pop-up en `/embudo?contacto=<id>`); el grupo abre el
  Embudo. Temperatura, cotización y Detalle (autollenado incluido) van sin aviso.
- La conexión del SSE queda abierta en todo el CRM (la usa el aviso). Un tablero que se suscribe con
  ella ya abierta pide su propio `reload` (`useInboxStream(…, { reloadIfOpen: true })`). En cada
  latido (25 s) el servidor revalida sesión, usuario activo y membresía (`lib/inbox/stream-access.ts`):
  a un vendedor desactivado se le corta el stream.
- Pendientes teóricos: un aviso emergente que llegue justo durante una reconexión se pierde (el
  tablero sí se pone al día). Una temperatura recuperada por la puesta al día no queda anotada como
  "reciente": si en ese mismo instante llega una recarga completa (importación) leída antes, puede
  volver a la vieja hasta el siguiente cambio. Si falla la recarga completa que dispara
  `contacts.bulk` (importación de un admin; camino anterior a esta rama, `router.refresh` no avisa si
  falló), los importados no aparecen en ese Embudo hasta la siguiente reconexión o recarga.
- Fallos de red: las lecturas en vivo del Embudo (contactos nuevos, cambios, puesta al día) y del
  Detalle (también la carga al abrirlo, con "Reintentando…") se reintentan solas, 5 s … 60 s.

### Lo que NO va (vs. GHL)
Nueva conversación/Importar (requiere plantilla: llega con el número real), asignado/seguido/chat
interno/visualizaciones, selección múltiple, íconos de llamar/carpeta/correo/borrar,
propietario/seguidores/etiquetas, autor del mensaje.

## Contrato de datos (backend → UI)

Server actions y funciones de lectura en `lib/inbox/` (todas filtran por la organización activa de
la sesión). Tipos exactos en `lib/inbox/types.ts`.

| Función | Para | Devuelve |
|---|---|---|
| `listConversations({ filter: "unread"\|"all"\|"starred", search?, cursor? })` | Lista | filas: `id`, `contact{id,name,phone,avatarInitials}`, `lastMessage{preview,direction,kind,at}`, `unreadCount`, `isStarred`, `awaitingReplySince` (semáforo), `windowExpiresAt` + `nextCursor` |
| `getConversation(conversationId)` | Encabezado + panel | `contact{…, stage, temperature}`, `windowExpiresAt`, `adReferral?` |
| `getConversationByContact(contactId)` | Tarjeta del kanban → chat | lo mismo que `getConversation`, o `null` si ese contacto aún no tiene chat |
| `listMessages(conversationId, { before?, limit? })` | Chat (paginado hacia atrás) | `id`, `direction`, `kind`, `body`, `attachments[{index,kind,fileName,mimeType,state:"ready"\|"processing"\|"failed",url}]`, `status`, `errorMessage?`, `sentAt`, `adReferral?` |
| `sendMessage(conversationId, text)` | Composer | `{ ok:true, messageId, pending }` o `{ ok:false, code, message }`. `pending:true` = envío en curso sin confirmar: se muestra "enviando", **sin** botón de reintentar. Códigos: `empty\|window_closed\|not_found\|not_linked\|not_retryable\|channel_unavailable\|provider_rejected\|not_configured` |
| `retryMessage(messageId)` | ⚠ Reintentar | igual que `sendMessage`. Solo tiene sentido cuando `message.canRetry` es `true` (rechazo definitivo del proveedor); un envío ambiguo NO se reintenta |
| `markConversationRead(conversationId, upToMessageId?)` | Al abrir / al leer | `void`. `upToMessageId` = último mensaje a la vista (corte de lectura); sin él, marca hasta el último entrante. Lo posterior al corte sigue sin leer |
| `setConversationStarred(conversationId, starred)` | Estrella | `void` |
| etapa/temperatura | Panel | se reusan las acciones existentes de Contactos |
| `GET /api/inbox/stream` (SSE) | Tiempo real | eventos con nombre (`event:`) y JSON en `data:` — `conversation.updated {conversationId}`, `message.upserted {conversationId, messageId}`, `message.deleted {conversationId, messageId}` (el eco ganó la carrera y se borró la fila en cola), `contact.created {contactId}`, `contacts.bulk`, `contact.updated {contactId, contactName, changes, stage?, by, at}` (ver "Cambios en vivo"), `inbox.bulk {contactos}` (lote del historial del celular: el importador apaga el aviso por fila en su transacción —migración 0039— y manda uno cada 500 mensajes o 5 s; la Bandeja relee su lista y el hilo abierto una vez, el Embudo relee el tablero a lo más cada 30 s si nacieron contactos; docs/go-live.md). Al (re)conectar manda `event: reload` → la UI revalida todo. La UI, ante cada evento, vuelve a pedir esa fila/mensaje. Solo llegan eventos de la organización de la sesión |

`listMessages` devuelve además `canRetry` por mensaje (si el botón Reintentar debe aparecer) y
`attachments[].state` (`ready\|processing\|failed`).

Los adjuntos se muestran con `url` = `/api/media/{messageId}/{index}` (ya existe; exige sesión;
302 a una URL firmada cuando está listo; 202 mientras está "processing"; 404 si no es de tu
organización).

## Handoff al track UI (18-sep-2026)

El backend de la bandeja está implementado y probado (migración 0008, `lib/inbox/`, SSE). Para la UI:

- **Fuente de verdad de tipos:** `lib/inbox/types.ts` (importar de ahí; `import type`, no arrastra el servidor).
- **Acciones (server actions):** `lib/inbox/actions.ts` — `listConversations`, `getConversation`,
  `getConversationByContact`, `listMessages`, `sendMessage`, `retryMessage`,
  `markConversationRead`, `setConversationStarred`. Ninguna recibe `organizationId`: se resuelve
  de la sesión.
- **Tiempo real:** `EventSource("/api/inbox/stream")`. Escuchar los eventos por nombre
  (`conversation.updated`, `message.upserted`, `message.deleted`, `reload`) y revalidar; el
  `EventSource` reconecta solo y cada reconexión reenvía `reload`.
- **Etapa/temperatura** del panel: reusar las acciones de Contactos (mismas del tablero).
- El chat es **un solo componente** reutilizado en Bandeja y en el panel lateral de Contactos.
