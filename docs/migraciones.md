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

| Servicio | Pre-deploy | Arranque |
|---|---|---|
| web `crm-diluvium` | `npm run db:deploy` | `npm run start` |
| worker (`worker-production` en prod, `worker` en staging) | `npm run db:check -- --wait 900` | `npx tsx worker/index.ts` (igual) |

(Leído de la API de Railway el 25-sep-2026: staging tiene exactamente esto; no trae un tope de tiempo
propio del pre-deploy configurado.)

- Si falta una migración (saltada o fallida), el pre-deploy del web falla → no hay despliegue nuevo del
  web; el del worker espera y, al vencer, también falla → sigue el worker anterior. Nada se cae; el log
  de Railway dice exactamente qué migración falta.
- Orden: web y worker despliegan a la vez; el worker espera en su pre-deploy a que el web migre.

**Cuándo se aplica cada configuración** (el pre-deploy exige que `db:check` exista en el código que se
despliega):
- **staging:** al subir esta rama a `staging` (misma vez).
- **production:** al mezclar esta rama a `main`, con la luz verde del dueño (antes, cualquier despliegue
  de main fallaría por no tener `db:check`). **Preparado, SIN aplicar** (25-sep-2026):
  `~/Documents/Diluvium CRM/notas/anuncios-predeploy-produccion/` (`patch-produccion.json` + `aplicar.py`;
  sin `--confirmar` solo muestra el cambio). Se aplica DESPUÉS de que main ya tenga `db:deploy`/`db:check`.
  Hoy production arranca el web con `npm run start:web` (migra + chequea + next start) y no tiene pre-deploy.

Se configura por la API de Railway (el CLI no expone pre-deploy) con
`environmentPatchCommit(environmentId, patch: { services: { <serviceId>: { deploy: { preDeployCommand, startCommand } } } })`,
que cambia SOLO ese entorno. **No usar `serviceInstanceUpdate`**: sin fork del entorno cambia TODOS.
(IDs en la memoria de infraestructura; production solo con luz verde).

**Revisión de production (25-sep-2026, solo lectura, conexión con `default_transaction_read_only=on`):**
con el journal de main (ebcd981) → "Migraciones al día" (0000–0034 aplicadas). Aviso heredado, no
bloquea: `0013_spooky_turbo` aplicada con un `.sql` distinto al del repo (se editó después de aplicarse).
Con el journal de esta rama le faltan solo `0035_anuncios_meta` y `0036_anuncios_estado`, que su `when`
(posterior a la 0034) hace que drizzle aplique al desplegar.

## Numeración (idx = número del tag)

`drizzle-kit generate` nombra la siguiente migración con **el idx de la ÚLTIMA entrada del journal + 1**
y escribe `meta/<ese número>_snapshot.json` (node_modules/drizzle-kit/bin.cjs, `writeResult`); toma
como base el último snapshot por nombre. El migrador de drizzle-orm NO usa idx (solo tag, `when` y hash).
Regla (la cuida `lib/db/migrations-journal.test.ts`): **el idx de cada entrada es el número de su tag**,
creciente; la última migración tiene su snapshot y es el último por nombre; el siguiente número no existe.
La 0030 quedó vacía: se reservó para Anuncios, main siguió con 0031–0034 (con idx 30–33, y el siguiente
generate en main habría pisado el `0034_snapshot`) y Anuncios entró como 0035. Prueba de aceptación
(25-sep): sobre main + Anuncios, `drizzle-kit generate` creó `0037_…sql` + `0037_snapshot.json` sin tocar
ningún archivo existente (solo agregó su entrada al journal), el test del journal pasó y `db:deploy` dejó
"al día" una base tipo production (hasta 0034) y una tipo staging (con 0035/0036).

## Si el candado detiene un despliegue

1. Ver en el log del pre-deploy qué migración falta (`FALTAN n migración(es): <tag> (when …)`).
2. Si drizzle la saltó por `when` menor: regenerar esa migración con un `when` posterior al último
   aplicado (idempotente si ya se aplicó en algún entorno) y volver a desplegar.
3. Nunca borrar filas de `drizzle.__drizzle_migrations` a mano para "destrabar".
