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

### Programados (A6)
Van dentro del hilo, al final, como burbujas punteadas "🕒 Programado para …" con Editar/Cancelar
(fallidos: Reintentar/Descartar; cancelados solos: el cliente escribió antes o el autor ya no está
activo). El composer tiene 🕒 junto a "Enviar" (y junto a "📄 Enviar plantilla" fuera de ventana).

### Apagar bot (25-sep-2026)
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
| `GET /api/inbox/stream` (SSE) | Tiempo real | eventos con nombre (`event:`) y JSON en `data:` — `conversation.updated {conversationId}`, `message.upserted {conversationId, messageId}`, `message.deleted {conversationId, messageId}` (el eco ganó la carrera y se borró la fila en cola). Al (re)conectar manda `event: reload` → la UI revalida todo. La UI, ante cada evento, vuelve a pedir esa fila/mensaje. Solo llegan eventos de la organización de la sesión |

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
