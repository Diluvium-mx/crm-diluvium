# Corte a producción del canal WhatsApp — checklist

Pasos para habilitar el canal en `production`. **Requiere OK y secretos del dueño** (los pega él,
nunca van al chat ni al repo). Nada de esto se hace sin ese OK.

Estado verificado el 18-sep-2026 con `railway variables --environment <env> --service <svc> --json`
(solo NOMBRES de variables, nunca valores). "Falta" = no está puesta en ese servicio de producción.

## Estado actual (real)

| Servicio (prod) | Tiene | Falta para WhatsApp |
|---|---|---|
| web `crm-diluvium` | `APP_URL`, `AUTH_SECRET`, `DATABASE_URL`, `REDIS_URL`, `SEED_USER_EMAIL`, `SEED_USER_PASSWORD` | `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `ZERNIO_ALLOWED_ACCOUNT_IDS`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| `worker` | (prácticamente vacío: solo variables `RAILWAY_*`) | `DATABASE_URL`, `REDIS_URL`, `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `S3_*` (5). El worker de prod **no** necesita `ZERNIO_ALLOWED_ACCOUNT_IDS` (la allowlist la aplica el webhook, que vive en el web) |
| `Postgres`, `Redis` | existen en prod | — |
| bucket de media | el probe del CLI no lo confirmó en ningún entorno; en **staging** los `S3_*` del web y worker SÍ están puestos (hay bucket detrás). **Verificar el nombre exacto del servicio de bucket en el dashboard** antes de crear el de prod | crear bucket de **producción** |

Referencia de lo que debe quedar (fuente: `staging`, que ya funciona):
- staging web `crm-diluvium`: `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `ZERNIO_ALLOWED_ACCOUNT_IDS`, `S3_BUCKET/ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY`.
- staging worker: lo mismo **sin** `ZERNIO_ALLOWED_ACCOUNT_IDS`.
- Catálogo de variables y para qué son: `.env.example` (`ZERNIO_*` → `lib/messaging`; `S3_*` → bucket de media, web y worker).

## Pasos (en orden)

### 1. Start command por servicio (dashboard de Railway, no hay `railway.json`)
Fuente de los scripts: `package.json`.
- [ ] web `crm-diluvium` (prod): *Custom Start Command* = `npm run start:web`
      (= `drizzle-kit migrate && next start`, migra antes de arrancar).
- [ ] `worker` (prod): *Custom Start Command* = `npm run start:worker` (= `tsx worker/index.ts`),
      y build **sin** `next build` (igual que en staging).
- [ ] Confirmar que el deploy trigger de `production` es la rama `main` (web y worker) — `docs/staging.md`.

### 2. Bucket de media de producción
- [ ] Crear el Storage Bucket de producción (privado), como el de staging.
- [ ] Poner `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` en el
      **web** y en el **worker** de prod, apuntando a ese bucket (en staging son referencias
      `${{<bucket>.*}}`; usar el mismo patrón, no valores literales).

### 3. Variables de Zernio (secretos del dueño)
- [ ] `ZERNIO_API_KEY` y `ZERNIO_WEBHOOK_SECRET` en **web** y **worker** de prod (los pega el dueño).
- [ ] `ZERNIO_ALLOWED_ACCOUNT_IDS` en el **web** de prod = el `accountId` del **número real**
      (no el del sandbox). Sin esta variable el webhook responde 503 (falla cerrado).
- [ ] `worker` de prod: agregar `DATABASE_URL` y `REDIS_URL` (referencias al Postgres/Redis de prod,
      `${{Postgres.DATABASE_URL}}` / `${{Redis.REDIS_URL}}`), que hoy le faltan.

### 4. Webhook de Zernio → producción
- [ ] Crear en Zernio el webhook que apunta a `https://<dominio-prod>/api/webhooks/zernio`
      (en staging es el endpoint equivalente de `crm-diluvium-staging.up.railway.app`).
- [ ] Verificar que el `ZERNIO_WEBHOOK_SECRET` del webhook coincide con el de las variables de prod
      (la firma se valida en `app/api/webhooks/zernio/route.ts`).

### 5. Migraciones en prod
- [ ] Al desplegar `main`, `start:web` corre `drizzle-kit migrate` automáticamente. Confirmar en los
      logs del web de prod que aplicaron hasta la última (0007_webhook_events_tenant en el track
      WhatsApp; 0008_inbox_destacado_referral cuando entre la bandeja).

### 6. Verificación (con el número real, gate del dueño)
- [ ] `POST` de prueba al webhook responde 401 sin firma y 200 con firma (como en staging).
- [ ] Un mensaje real entra, se ve en la bandeja, se responde y llega al celular (criterio de la Fase 2, CLAUDE.md §9).
- [ ] Media real (foto/PDF/audio) se guarda con `storageKey` y `/api/media/...` la sirve.
- [ ] Activar **atribución de anuncios** en la config de WhatsApp Business (sin eso Meta no manda el `referral`).
- [ ] Confirmar con Zernio cómo llega el historial de 6 meses de coexistencia (¿API o webhook?).

## Recordatorios
- Ninguna rama se mergea a `main` sin OK del dueño.
- Los seeds de producción NO se borran; el borrado de organización está deshabilitado en v1.
- Los secretos los pega el dueño en Railway (portapapeles), nunca en el chat ni en el repo.
