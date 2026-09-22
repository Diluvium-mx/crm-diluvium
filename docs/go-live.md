# Go-live del número real de WhatsApp (Zernio, coexistencia)

Checklist para conectar el número real (+52 668 241 9579) a **producción**. Si la
cuenta del número no está en `ZERNIO_ALLOWED_ACCOUNT_IDS`, sus mensajes llegan al
webhook, se contestan con 200 y quedan **en cuarentena** (`webhook_events.quarantined_at`):
no se pierden, pero tampoco aparecen en la Bandeja hasta liberarlos. Cada uno deja un
`console.warn` con `account_id` y tipo, y el worker avisa cada minuto
(`[worker] CUARENTENA: …`). Liberarlos tras corregir la allowlist y el canal:
`npx tsx scripts/replay-webhook-events.ts` (la cuarentena caduca a los 30 días).

Todo se valida primero en `staging` (CLAUDE.md §4). Los secretos los pega el dueño
por portapapeles; nunca en el chat.

## 1. Cuenta del número en Zernio

1. Conectar el número en Zernio (coexistencia) y anotar su `accountId`:
   `GET https://zernio.com/api/v1/accounts` (o `GET /v1/phone-numbers` → `connected`).
2. Confirmar que NO es el sandbox (`isSandbox` ausente/false). El sandbox solo acepta
   un teléfono verificado por usuario; el número real recibe de cualquier número.

## 2. Variables de entorno (web **y** worker de producción)

- `ZERNIO_ALLOWED_ACCOUNT_IDS` = ids separados por coma. Agregar el `accountId` real
  (y quitar el del sandbox cuando ya no se use en prod).
- `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET` ya existen; si se crea un webhook nuevo,
  su secret cambia → actualizar `ZERNIO_WEBHOOK_SECRET` en web y worker.

## 3. Fila en `channels` (base de producción)

La organización del mensaje sale del canal, nunca del payload. Sin fila activa, la
ingesta reintenta y termina en dead-letter:

```sql
INSERT INTO channels (id, organization_id, type, provider, provider_account_id, display_name, is_active)
VALUES ('ch_zernio_real', '<organization_id de Diluvium>', 'whatsapp', 'zernio',
        '<accountId real>', 'WhatsApp Diluvium', true);
```

(Revisar columnas contra `lib/db/schema/messaging.ts` antes de correrlo.)

## 4. Webhook de Zernio

- Un solo webhook por entorno. Hoy el webhook `6aada7b42e8ced562ab17997` se llama
  "crm-diluvium staging" pero **apunta a producción**
  (`https://crm-diluvium-production.up.railway.app/api/webhooks/zernio`); renombrarlo
  y crear uno propio para staging si se vuelve a probar allí.
- Eventos suscritos: `message.received`, `message.sent`, `message.delivered`,
  `message.read`, `message.failed`, **`reaction.received`, `message.edited`,
  `message.deleted`** (los tres últimos los procesa la ingesta desde `fix/webhook-inbound`).
- Verificar: `GET /v1/webhooks/settings` → `isActive: true`, `failureCount: 0`;
  `POST /v1/webhooks/test` → 200.

## 5. Datos

- Backfill de teléfonos (partes por país, México +52 + 10, país vacío):
  `npx tsx scripts/backfill-phone-parts.ts` (simulación) y luego `--apply`.
  Staging primero; producción solo con OK del dueño.

## 6. Prueba de humo

1. Desde un teléfono que NO sea de prueba, mandar texto, foto y PDF al número real.
2. Debe aparecer en Bandeja (y en Contactos, columna Inbox, arriba) en segundos.
3. Responder desde el CRM → llega al celular con ✓✓.
4. Revisar: `select count(*) from webhook_events where processed_at is null` = 0 y
   `dead_lettered_at is not null` = 0.

## Riesgo conocido (aceptado hasta la fusión de contactos)

Si un mismo cliente ya existe como DOS contactos, cada uno con su conversación (p. ej.
uno importado de GHL con su teléfono y otro creado solo por BSUID), la ingesta no
reasigna ni fusiona: cada mensaje sigue a la conversación por la que llega, así que el
historial queda repartido. No se pierde nada y cada caso deja en los logs del worker
`[ingest] identidad: … revisar para fusionar` con ambos ids. Se resuelve con la
herramienta de fusión de contactos (pendiente, junto con los 5 grupos de duplicados de
GHL). Mientras tanto: buscar esa línea en los logs tras el go-live.
