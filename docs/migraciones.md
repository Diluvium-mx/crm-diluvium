# Candado de migraciones (despliegue sin caída)

25-sep-2026, rama `feat/anuncios-meta`. Resuelve de raíz el riesgo de ramas en paralelo con
migraciones fuera de orden.

## El problema

`drizzle-orm` aplica una migración solo si su `when` (journal) es MAYOR que el `created_at` de la
última aplicada (`node_modules/drizzle-orm/pg-core/dialect.js`). Una migración con `when` menor —la de
una rama que entra a main después de otra más nueva— **se salta en silencio** y `drizzle-kit migrate`
termina "migrations applied successfully". Probado dos veces el 25-sep:

- base con la 0030 (Anuncios) aplicada y llega la 0027 (Fase D): la tabla `workflows` no existe y
  `drizzle-kit migrate` dice que todo bien;
- base de pruebas con la 0030 y llega la 0034 (Fase E 2, `when` menor): igual, saltada.

Además, en Railway hoy (antes de este cambio):

| Servicio | Arranque | Qué pasa si la migración falla |
|---|---|---|
| web `crm-diluvium` (production) | `npm run start:web` = `drizzle-kit migrate && next start` | el contenedor nuevo muere; sin healthcheck ni pre-deploy, el despliegue nuevo ya reemplazó al anterior → **caída** |
| web `crm-diluvium` (staging) | `npx drizzle-kit migrate && next start` | igual |
| `worker-production` / `worker` (staging) | `npx tsx worker/index.ts` | espera a que el web migre comparando solo la ÚLTIMA migración: una saltada no se nota |

## La solución

1. **`npm run db:check`** (`scripts/check-migrations.ts` + `lib/db/migration-check.ts`): compara
   CADA entrada del journal contra `drizzle.__drizzle_migrations` (`created_at` = `when`). Si falta
   alguna, sale con código 1 y la nombra. Además avisa (sin bloquear) si una migración aplicada tiene
   otro `.sql` que el del repo (hash) o si la base tiene filas que no están en el journal.
   `npm run db:check -- --wait 900` espera hasta 900 s a que aparezcan (para el worker).
2. **`npm run db:deploy`** = `drizzle-kit migrate && db:check`.
3. **El worker** (`lib/db/wait-for-migrations.ts`) ya no arranca colas si falta CUALQUIER migración.
4. **`start:web`** también corre el chequeo (respaldo si un entorno aún no tiene pre-deploy).

## Cómo se conecta al despliegue (Railway)

Railway ejecuta el **pre-deploy command** en un contenedor aparte, con las variables del servicio,
ANTES de arrancar el despliegue nuevo. Documentación oficial
(docs.railway.com/guides/pre-deploy-command): *"If your command fails, it will not be retried and the
deployment will not proceed."* El despliegue nuevo nunca se activa → **el anterior sigue atendiendo,
sin caída**.

| Servicio | Pre-deploy | Arranque | Pre-deploy timeout |
|---|---|---|---|
| web `crm-diluvium` | `npm run db:deploy` | `npm run start` | 600 s |
| worker (`worker-production` en prod, `worker` en staging) | `npm run db:check -- --wait 900` | `npx tsx worker/index.ts` (igual) | 1000 s |

- Si falta una migración (saltada o fallida), el pre-deploy del web falla → no hay despliegue nuevo del
  web; el del worker espera y, al vencer, también falla → sigue el worker anterior. Nada se cae; el log
  de Railway dice exactamente qué migración falta.
- Orden: web y worker despliegan a la vez; el worker espera en su pre-deploy a que el web migre.

**Cuándo se aplica cada configuración** (el pre-deploy exige que `db:check` exista en el código que se
despliega):
- **staging:** al subir esta rama a `staging` (misma vez).
- **production:** al mezclar esta rama a `main`, con la luz verde del dueño (antes, cualquier despliegue
  de main fallaría por no tener `db:check`).

Se configura por la API de Railway (el CLI no expone pre-deploy):
`serviceInstanceUpdate(serviceId, environmentId, input: { preDeployCommand, startCommand, preDeployTimeoutSeconds })`
(IDs en la memoria de infraestructura; los de production solo con luz verde).

## Si el candado detiene un despliegue

1. Ver en el log del pre-deploy qué migración falta (`FALTAN n migración(es): <tag> (when …)`).
2. Si drizzle la saltó por `when` menor: regenerar esa migración con un `when` posterior al último
   aplicado (idempotente si ya se aplicó en algún entorno) y volver a desplegar.
3. Nunca borrar filas de `drizzle.__drizzle_migrations` a mano para "destrabar".
