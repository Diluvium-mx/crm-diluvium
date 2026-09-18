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
│ fila: avatar,nombre,│ burbujas + adjuntos + estado ✓✓   │ Ver ficha completa     │
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
Nombre, teléfono, **etapa** y **temperatura** editables (las mismas del tablero, sincronizadas) y
"Ver ficha completa" (panel de detalle de Contactos).

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
| `sendMessage(conversationId, text)` | Composer | `{ ok, messageId }` o `{ ok:false, code:"window_closed"\|… , message }` |
| `retryMessage(messageId)` | ⚠ Reintentar | igual que `sendMessage` |
| `markConversationRead(conversationId)` | Al abrir | `void` |
| `setConversationStarred(conversationId, starred)` | Estrella | `void` |
| etapa/temperatura | Panel | se reusan las acciones existentes de Contactos |
| `GET /api/inbox/stream` (SSE) | Tiempo real | eventos `conversation.updated {conversationId}` y `message.upserted {conversationId, messageId}` → la UI vuelve a pedir esa fila/mensaje |

Los adjuntos se muestran con `url` = `/api/media/{messageId}/{index}` (ya existe; exige sesión;
202 mientras está "processing").
