# Investigación: plantillas de WhatsApp por la API de Zernio

**Estado:** investigado el 21-sep-2026, para la 2ª mitad de la Fase 2 (sección Fragmentos + Plantillas).
**Pregunta del dueño:** ¿Zernio expone CRUD de plantillas de WhatsApp por REST? Diseñar Plantillas
para AMBOS casos (siempre listar+enviar; sumar el alta por API solo si Zernio la deja).

## Respuesta corta: SÍ, Zernio expone CRUD de plantillas por REST

Zernio tiene un namespace `/v1/whatsapp/*` (el mismo de `dataset`/`conversions`/`media` que ya
usamos) con endpoints de plantillas, **además** del envío por el inbox que ya usa la bandeja.
Se puede **listar, crear, actualizar y enviar** por API. El alta NO obliga a entrar a mano a
WhatsApp Manager — aunque Meta igual revisa toda plantilla nueva antes de aprobarla (queda `PENDING`).

Por eso diseñamos Plantillas así:
- **Siempre:** listar (sincronizar desde Zernio) + enviar las **aprobadas**, rellenando variables.
- **Alta por API (se suma):** un alta opcional desde el CRM que llama a Zernio y deja la plantilla
  en revisión de Meta. NO es edición en vivo: una plantilla aprobada es inmutable (regla de Meta),
  y el alta nueva no se puede usar hasta que Meta la apruebe.
- El alta a mano en WhatsApp Manager sigue siendo válida (la WABA es de "Grupo Diluvium"); el CRM
  la ve en cuanto se sincroniza.

## Endpoints (confirmados)

Base: `https://zernio.com/api` (la misma `ZERNIO_BASE_URL` de la bandeja). Auth: `Bearer` con
`ZERNIO_API_KEY`. Todo endpoint de WhatsApp exige `accountId` (el número conectado).

| Acción | Método + ruta | Fuente |
|---|---|---|
| Listar plantillas | `GET /v1/whatsapp/templates?accountId=…` | docs.zernio.com/platforms/whatsapp/templates |
| Crear plantilla | `POST /v1/whatsapp/templates` | docs (idem) |
| Actualizar plantilla | `PATCH /v1/whatsapp/templates/{name}` (o `/id/{templateId}`) | docs (idem) |
| **Enviar plantilla en una conversación existente** | `POST /v1/inbox/conversations/{conversationId}/messages` con cuerpo `template` | **adapter oficial `src/api-client.ts` → `sendTemplate()`** |
| Abrir conversación NUEVA con plantilla (cold-start) | `POST /v1/inbox/conversations` con `templateName`/`templateLanguage`/`templateParams` | adapter `src/api-client.ts` → `createConversation()` + `src/types.ts` `ZernioCreateConversationBody` |
| Estado de revisión de Meta | webhook `whatsapp.template.status_updated` | docs (idem) |

### Enviar una plantilla (el caso que nos importa: fuera de la ventana de 24 h)

Nuestras conversaciones ya existen en la bandeja. Cuando la ventana de 24 h está **cerrada**, se
continúa la conversación con una plantilla por el MISMO endpoint que ya usa `sendText`:

`POST /v1/inbox/conversations/{conversationId}/messages`

```jsonc
{
  "accountId": "<accountId del canal>",
  "template": {
    "elements": [
      {
        "name": "order_confirmation",
        "language": "es_MX",
        "components": [
          { "type": "body",
            "parameters": [
              { "type": "text", "text": "Ana" },
              { "type": "text", "text": "ORD-12345" }
            ] }
        ]
      }
    ]
  }
}
```

Fuente autoritativa (código, no prosa): el wrapper del adaptador oficial arma exactamente ese
cuerpo —
```ts
// zernio-dev/chat-sdk-adapter, src/api-client.ts
async sendTemplate(conversationId, accountId, template) {
  return this.sendMessage(conversationId, { accountId, template: { elements: [template] } });
}
```
y `WhatsAppTemplate = { name: string; language: string; components?: Array<Record<string, unknown>> }`
(`src/types.ts`). Los `components`/`parameters` siguen el shape del objeto `template` de la Cloud
API de Meta (posicional: `body_text` = `{{1}}`, `{{2}}`, …).

**La ventana no la reabre el envío de la plantilla.** En el modelo de Meta, la ventana de servicio
de 24 h solo la abre un mensaje ENTRANTE del cliente. Una plantilla se puede mandar con la ventana
cerrada (ese es su propósito), pero mandarla no cambia `conversations.window_expires_at`: eso solo
lo mueve la ingesta de un entrante (lib/messaging/ingest.ts). El comentario "re-opens the 24h
window" del adaptador es impreciso; no lo seguimos.

### Listar plantillas — shape de respuesta

`GET /v1/whatsapp/templates?accountId=…` (según docs.zernio.com/platforms/whatsapp/templates):

```jsonc
{
  "success": true,
  "templates": [
    {
      "id": "1234567890123456",
      "name": "order_confirmation",
      "status": "APPROVED",
      "category": "UTILITY",
      "language": "es_MX",
      "components": [
        { "type": "BODY", "text": "Hola {{1}}, tu pedido {{2}} está confirmado." }
      ]
    }
  ]
}
```

- **status:** `PENDING | APPROVED | REJECTED | IN_APPEAL | PAUSED | DISABLED | PENDING_DELETION`.
  Solo se pueden **enviar** las `APPROVED`.
- **category:** `UTILITY | MARKETING | AUTHENTICATION`.
- **Variables:** posicionales `{{1}}`, `{{2}}` dentro del componente `BODY`. (Distinto de los
  Fragmentos, que usan variables con NOMBRE `{{nombre}}` porque son texto libre nuestro.)
- Paginación: no documentada; si aparece `pagination.nextCursor` se itera, si no, una sola página
  (una PyME tiene decenas de plantillas, no miles).

### Crear plantilla (alta opcional por API)

`POST /v1/whatsapp/templates` (según docs):

```jsonc
{
  "accountId": "<accountId>",
  "name": "order_confirmation",
  "category": "UTILITY",
  "language": "es_MX",
  "components": [
    { "type": "body",
      "text": "Hola {{1}}, tu pedido {{2}} está confirmado.",
      "example": { "body_text": [["Ana", "ORD-12345"]] } }
  ]
}
```

Queda `PENDING` hasta que Meta la revise. El resultado de la revisión llega por el webhook
`whatsapp.template.status_updated` (o se ve al volver a sincronizar).

## Cómo lo implementa el CRM (decisiones)

1. **Interfaz de proveedor** (`lib/messaging/provider.ts`): se agregan `listTemplates`,
   `sendTemplate` y `createTemplate` a `MessagingProvider`, para no atar el resto del CRM a Zernio
   (cuando se migre a la Cloud API directa, el otro adaptador cumple la misma interfaz). Igual que
   `sendText`, `sendTemplate` usa `Idempotency-Key` = id de NUESTRO mensaje y clasifica el fallo en
   `rejected` (4xx, no salió, se puede reintentar) vs. `unknown` (timeout/5xx/2xx sin id: no se
   reintenta a ciegas, se reconcilia por el eco o el barrido del worker). Patrón outbox idéntico
   al de texto (lib/messaging/send.ts).
2. **Sincronización → tabla `templates`** (CLAUDE.md §5, ya existe): un `syncTemplates` lee
   `GET /v1/whatsapp/templates` y hace upsert por (channel, name, language). Guarda `status`,
   `body` (texto del BODY), `variables` (posiciones + ejemplo si viene), `provider_template_id`.
   La UI lee de la tabla (rápido, acotado por organización) y filtra a `APPROVED` para enviar.
   Botón "Sincronizar" manual; el webhook de estado puede refrescar después.
3. **Enviar plantilla:** `sendTemplateMessage` (lib/messaging/send.ts) NO valida la ventana de 24 h
   (una plantilla se manda precisamente cuando está cerrada), inserta la fila `type:"template"` con
   `template_name` y `body` = vista previa con variables rellenadas (para la burbuja del hilo), y
   reusa `linkSentMessage` (enlaza el eco, no duplica).

## Riesgos / a verificar en staging (sandbox), nunca directo en producción (CLAUDE.md §4)

- El shape de **envío** viene de código real del adaptador (alta confianza). Los de **listar/crear**
  vienen de la prosa de docs.zernio.com vía fetch (confianza media): verificar contra el sandbox de
  Zernio en `staging` antes de tocar el número real. Es exactamente para lo que existe `staging`.
- Idioma de plantilla: Meta usa códigos tipo `es_MX` / `es`. Guardar y mandar el `language` EXACTO
  que devuelve el listado (la unicidad de la tabla es por `channel + name + language`).
- Errores de Zernio al enviar plantilla (p. ej. plantilla pausada por Meta, parámetro faltante) no
  se tragan: van a `messages.error_code` / `error_message` y se ven en la UI (CLAUDE.md §7).

## Fuentes

- Adaptador oficial de Zernio (código, fuente de verdad del envío): https://github.com/zernio-dev/chat-sdk-adapter — `src/api-client.ts` (`sendTemplate`, `createConversation`), `src/types.ts` (`ZernioSendMessageBody.template`, `WhatsAppTemplate`, `ZernioCreateConversationBody`).
- Zernio, plantillas de WhatsApp (CRUD, estados, categorías): https://docs.zernio.com/platforms/whatsapp/templates
- Zernio, WhatsApp (índice de la plataforma: Broadcasts, Templates, Inbox, Media & Limits…): https://docs.zernio.com/platforms/whatsapp
- Zernio, Chat SDK (adaptador oficial, referencia): https://chat-sdk.dev/adapters/vendor-official/zernio
- Meta, objeto `template` (componentes y parámetros posicionales): https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
