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

## 5b. Monitoreo: umbral de silencio

Hasta el go-live, el web de producción tiene `MONITOR_SILENCE_MINUTES=1440` (el sandbox
casi no tiene tráfico y la alerta de silencio saltaba cada 15 min; issue #7). **Al conectar
el número real, regresar `MONITOR_SILENCE_MINUTES` a 60** (Railway → crm-diluvium →
production → Variables) para que un silencio de 1 h en horario laboral vuelva a alertar.

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

## Monitoreo (Fase 3)

Dos vigilantes independientes; ninguno depende de WhatsApp ni de Zernio para avisar:

| Vigilante | Frecuencia | Qué revisa | Aviso |
|---|---|---|---|
| Worker (`worker/index.ts`) | cada 5 min | silencio de webhooks en horario laboral (lun–sáb 9–19 Mazatlán, `MONITOR_SILENCE_MINUTES`, 60 por omisión), eventos sin procesar > 5 min, dead-letter, cuarentena | log `[monitor] ALERTA: …` en Railway |
| GitHub Action `inbound-monitor` | cada 15 min | lo mismo vía `GET /api/health/inbound` + latido del worker (Redis) + webhook de Zernio activo y sin fallos | issue `alerta-whatsapp` (llega por correo); se cierra solo al sanar. Si el CRM no responde, también abre issue |

Configurar una vez (el dueño pega el valor; nunca en el chat):

1. Generar un token largo al azar (p. ej. `openssl rand -hex 32`).
2. Railway → servicio web de **producción** → variable `MONITOR_TOKEN` = ese valor.
3. GitHub → Settings → Secrets and variables → Actions → secret de repositorio
   `MONITOR_TOKEN` = el mismo valor.
4. Verificar a mano: Actions → inbound-monitor → Run workflow.

Riesgos aceptados del monitoreo y de las miniaturas:

- **GitHub apaga las Actions programadas** de un repo público tras 60 días sin actividad
  (mismo riesgo ya aceptado para los respaldos, CLAUDE.md §10.6). Si el repo lleva
  semanas sin commits, revisar que `inbound-monitor` siga activo (Actions → reactivar).
  El chequeo del worker (logs) sigue corriendo aunque la Action se apague.
- **Miniaturas de PDF:** el render corre en un proceso hijo con heap limitado, 20 s
  máximo, un PDF a la vez y PDFs de hasta 10 MB; aun así comparte la memoria del
  contenedor del worker (no hay un contenedor aparte). Si un PDF extremo tumbara el
  worker, Railway lo reinicia y el intento ya quedó contado (3 como máximo).

El endpoint solo devuelve conteos (el repo es público). Sin `MONITOR_TOKEN` responde 401 y
la Action abre un issue, así que el paso 2 va antes que el merge a `main`.

## Sandbox de Zernio (pruebas antes del número real)

- La sesión del teléfono de prueba (52 668 242 6364) vence el **25-sep-2026 21:14 UTC**
  (`GET /v1/whatsapp/sandbox/sessions` → `expiresAt`). Una sesión activada dura 7 días; una
  pendiente, 24 h ([doc](https://docs.zernio.com/whatsapp/create-whatsapp-sandbox-session.mdx)).
- No hay endpoint para "extender": se **renueva re-creándola** para el MISMO teléfono
  (idempotente; reenvía la plantilla `sandbox_start`):
  `POST https://zernio.com/api/v1/whatsapp/sandbox/sessions` con `{"phone": "+526682426364"}`
  y `Authorization: Bearer <ZERNIO_API_KEY>`. La sesión queda `pending` hasta que el teléfono
  **responda** la plantilla en WhatsApp; entonces pasa a `active` por 7 días más. Funciona
  también después de vencida.
- Un solo teléfono por usuario de Zernio: para probar con otro hay que revocar el actual
  (`DELETE /v1/whatsapp/sandbox/sessions/{id}`) y crear el nuevo. Límite: 50 mensajes / 24 h.
- Renovarla justo antes de la prueba en vivo del Agente IA (Fase B), no antes.
