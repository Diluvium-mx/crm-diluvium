# Operación del canal WhatsApp (Zernio)

Runbook para operar el canal ya desplegado. Todo lo que dice aquí sale del código y de la
configuración real de Railway (citado con archivo:línea y servicio/entorno), no de memoria.

## Servicios (Railway, proyecto `energetic-ambition`)

`docs/staging.md` y CLAUDE.md §4. Dos entornos: `production` y `staging`, cada uno con su propio
`crm-diluvium` (web), `worker`, `Postgres` y `Redis`.

- **web** `crm-diluvium`: Next.js (UI + API routes + **webhook** `/api/webhooks/zernio`). Arranque
  `npm run start:web` = `drizzle-kit migrate && next start` (`package.json`).
- **worker**: BullMQ; consume las colas y corre el **barrido** cada minuto. Arranque
  `npm run start:worker` = `tsx worker/index.ts` (`package.json`). Sin `railway.json` (eliminado):
  el *Custom Start Command* de cada servicio se fija en el dashboard de Railway.

## Qué hace el barrido del worker (cada 60 s)

Fuente: `worker/index.ts` (`SWEEP_EVERY_MS = 60_000`, `sweep()`).

1. **Re-encola webhooks pendientes** — eventos guardados en `webhook_events` sin procesar y con más
   de `SWEEP_MIN_AGE_MS` (60 s) y menos de `SWEEP_MAX_ATTEMPTS` intentos
   (`= DEAD_LETTER_ATTEMPTS = 20`, `lib/messaging/ingest.ts:27`). Cubre el caso "Redis no respondió
   cuando llegó el webhook": la base es la fuente de verdad, la cola solo acelera.
2. **Alerta de dead-letter** — cuenta los `webhook_events` sin procesar con `attempts >= 20` y los
   registra en consola (`[worker] DEAD-LETTER: N …`). Ver "Reprocesar" abajo.
3. **Expira envíos sin confirmar** — `expireUnconfirmedSends()` (`lib/messaging/send.ts`): un envío
   del CRM que quedó `queued` sin wamid por más de `SEND_UNCONFIRMED_AFTER_MS` (15 min,
   `send.ts:323`) pasa a `failed` con `error_code = send_unconfirmed`.
4. **Retención de `webhook_events`** — borra los **procesados** de más de `WEBHOOK_RETENTION_DAYS`
   (30 d, `worker/index.ts:37`). Los NO procesados (dead-letter) NO se tocan: quedan para replay.
5. **Media pendiente** — re-encola la descarga de adjuntos sin `storageKey` de mensajes de menos de
   `MEDIA_SWEEP_DAYS` (30 d) con menos de `MEDIA_MAX_ATTEMPTS` (25) intentos (`worker/index.ts`).
   Si falta la config de S3, la media queda desactivada y este paso se salta (la ingesta sigue).

## `error_code` de un mensaje saliente (`messages.error_code`)

Fuente: `lib/messaging/send.ts` y `lib/messaging/zernio.ts`. La UI decide "Reintentar" con
`canRetry` (`lib/inbox/format.ts`), que es `true` SOLO para un rechazo definitivo.

| `error_code` | Qué pasó | ¿Reintentable? |
|---|---|---|
| código del proveedor (p. ej. `131056`, `WINDOW_CLOSED`) | Rechazo **definitivo** de Zernio/WhatsApp (4xx): el mensaje NO salió | **Sí** (misma fila; `retryTextMessage`) |
| `send_unknown` / `send_unknown:<code>` | Resultado **desconocido** (timeout, corte, 5xx, 409, 2xx sin id): no se sabe si salió. Fila queda `queued` | **No** — se resuelve solo (eco) o pasa a `send_unconfirmed` |
| `send_unconfirmed` | El barrido lo dio por no confirmado tras 15 min | **No** (Zernio libera la clave de idempotencia al fallar → reintentar duplicaría). El vendedor revisa el chat y **reescribe** |

`send_unknown`/`send_unconfirmed` se detectan con `isAmbiguousSendError()` (`send.ts:60`). La
idempotencia usa `Idempotency-Key = id del mensaje` (`zernio.ts` `sendText`).

## Reprocesar eventos en dead-letter

`scripts/replay-webhook-events.ts` reactiva eventos (pone `attempts=0`, `processed_at=NULL`) para que
el barrido los reintente. Idempotente (el wamid único evita duplicar). Uso típico tras arreglar un
canal que faltaba o un cambio de formato del proveedor:

```bash
# todos los pendientes
npx tsx scripts/replay-webhook-events.ts
# uno o varios por id (el id es "<provider>_<eventId>", p. ej. zernio_evt_123)
npx tsx scripts/replay-webhook-events.ts zernio_evt_123 zernio_evt_456
```

Correr con las variables del entorno correcto (worker o web de ese entorno). Revisar antes
`webhook_events.last_error` para saber por qué cayó.

## Media

- El adjunto se guarda en el bucket con `storageKey`; la UI lo pide por `/api/media/{messageId}/{index}`
  (`app/api/media/[messageId]/[index]/route.ts`): 302 a URL firmada (5 min) si está listo, 202 si
  sigue "processing", 404 si es de otra organización, 503 si falta el bucket.
- Si el worker arranca sin `S3_*`, la media queda desactivada pero la ingesta de mensajes sigue; al
  configurar el bucket y reiniciar, el barrido recoge lo pendiente.

## Aislamiento por entorno (evitar que el número real entre a staging)

`ZERNIO_ALLOWED_ACCOUNT_IDS` (obligatoria, falla cerrado — `lib/messaging/index.ts` `allowedAccountIds`)
lista los `accountId` de Zernio que ESE entorno acepta. Un evento de otra cuenta se responde 200 y
NO se guarda. Zernio no filtra webhooks por cuenta, por eso existe esta allowlist.

## Retención y datos por organización

`webhook_events.organization_id` (FK con cascade) se puebla AL GUARDAR el evento
(`app/api/webhooks/zernio/route.ts`), así borrar una organización se lleva también sus payloads
crudos. El borrado de organización está **deshabilitado** en v1 (`lib/auth/index.ts`
`disableOrganizationDeletion: true`) hasta que el almacenamiento tenga limpieza durable.
