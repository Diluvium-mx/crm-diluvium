# Staging

Environment `staging` en Railway, creado como duplicado de `production`, con **su propio**
web, Postgres y Redis.

## Flujo

```
feature/*  →  staging (se valida en https://crm-diluvium-staging.up.railway.app)  →  main (producción)
```

- El web de staging despliega **solo** desde la rama `staging`, y producción solo desde `main`.
  Cada environment tiene su propio *deployment trigger* en Railway.
- Arranque por servicio (sin `railway.json`: Config as Code está deprecado y la API de Railway
  rechaza `railwayConfigFile`). Los comandos están versionados en `package.json`:
  - web: `npm run start:web` (= `drizzle-kit migrate && next start`): cada deploy migra antes de
    arrancar, así que una migración nueva se prueba en staging antes de llegar a producción;
  - worker: Custom Start Command `node --import tsx worker/index.ts` (igual que `npm run start:worker`,
    que hace `exec` de lo mismo) y **Draining 60 s**, build sin `next build`. Sin `npx`/`npm` en medio para
    que el aviso de apagado (SIGTERM) llegue al código y el worker termine lo que está en curso antes de
    cada despliegue (antes se cortaba de golpe: 0 s por defecto; revisión completa B8/B9, 28-sep-2026).
  El *Custom Start Command* de cada servicio en Railway debe ser exactamente ese script; al
  crear un servicio o un environment nuevo, es lo primero que se revisa.
- Para validar una rama, mérgala a `staging` y haz push. Cuando esté validada, abre el PR a `main`.

## CI

`.github/workflows/ci.yml` corre en **cada push a cualquier rama** (y a mano con *Run workflow*). Un
push nuevo a la misma rama cancela la corrida anterior. Usa un Postgres 18 y un Redis desechables del
propio job: sin secrets ni datos reales.

Qué revisa:
1. aplica **todas** las migraciones en una base vacía y corre el candado `npm run db:check`;
2. `next typegen` + `npm run typecheck` y `npm run lint`;
3. `npm test` completo, **incluidas** las de integración (`*.int.test.ts`, que necesitan
   `TEST_DATABASE_URL`) y las de Redis real del rate limit (`REDIS_TEST_URL`);
4. `npm run audit:prod` (dependencias de producción, nivel alto o crítico): **informativo**, no tumba la
   CI; el conteo y el detalle salen en el resumen de la corrida.

Cómo ver el resultado: palomita o tache junto al commit en GitHub, pestaña **Actions › ci**, o
`gh run list --branch <rama> --limit 3` y `gh run view <id> --log-failed`.

Si falla: abre el paso en rojo y reprodúcelo local igual que en CI (base con `test` en el nombre y en UTC):

```bash
createdb -h localhost crm_ci_test && psql -h localhost -d crm_ci_test -c "alter database crm_ci_test set timezone to 'UTC'"
DATABASE_URL=postgres://localhost:5432/crm_ci_test npm run db:migrate
./node_modules/.bin/next typegen && npm run typecheck && npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/crm_ci_test npm test
```

No se mergea a `staging` ni a `main` con la CI en rojo. Una prueba que falla no se salta ni se
«arregla» cambiando el producto: si falla solo por el entorno (Node 22, hora UTC del runner, base
vacía), se corrige la prueba o el workflow; si está rota de verdad, se arregla el código.

### Ajustes pendientes del dueño (no aplicados)

1. **Railway › «Wait for CI».** En el proyecto `energetic-ambition`, servicios `crm-diluvium` (web) y
   worker, en **production** y en **staging** › *Settings* › *Source* › activar **Wait for CI**. Railway
   espera a que terminen los checks de GitHub del commit y, si alguno falla, no lo despliega (queda
   *Skipped*) y sigue atendiendo la versión anterior. Prenderlo **cuando la CI ya esté en verde en
   `main`**; si no, el siguiente push a `main` se quedaría sin desplegar. Si una corrida se cancela
   porque llegó otro push a la rama, ese commit no se despliega pero el siguiente sí.
2. **Ruleset de `main` en GitHub:** bloquear force-push y borrado de la rama. **No** exigir checks ni PR:
   los merges a `main` se empujan directo y se rechazarían. Sin *bypass*: aplica también al dueño (si
   algún día hay que reescribir la historia, se desactiva el ruleset a propósito y se vuelve a prender).

   ```bash
   gh api -X POST repos/Diluvium-mx/crm-diluvium/rulesets --input - <<'JSON'
   {
     "name": "main: sin force-push ni borrado",
     "target": "branch",
     "enforcement": "active",
     "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
     "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ]
   }
   JSON
   gh api repos/Diluvium-mx/crm-diluvium/rulesets   # para comprobarlo
   ```

## Aislamiento verificado (18-sep-2026)

| | production | staging |
|---|---|---|
| `DATABASE_URL` del web | `${{Postgres.DATABASE_URL}}`, contraseña del Postgres de prod | misma referencia, contraseña del Postgres de **staging** |
| `REDIS_URL` del web | `${{Redis.REDIS_URL}}`, Redis de prod | misma referencia, Redis de **staging** |
| Volumen de Postgres / Redis | instancia de production | instancia propia de staging |
| `AUTH_SECRET` | propio | **nuevo**, generado con `openssl rand -base64 32` |
| `APP_URL` | dominio de prod | `https://crm-diluvium-staging.up.railway.app` |

El host `postgres.railway.internal` es el mismo en los dos environments, pero la red privada es
independiente en cada uno. Por eso `DATABASE_URL` y `REDIS_URL` son **referencias** y no valores
fijos: si alguien pega una URL literal de producción en staging, se rompe el aislamiento.

Para volver a comprobarlo (imprime solo hashes, nunca credenciales):

```bash
for env in production staging; do railway variable list -s crm-diluvium -e $env --json | python3 -c 'import json,sys,hashlib,urllib.parse as u; v=json.load(sys.stdin); print(v["RAILWAY_ENVIRONMENT_NAME"], [hashlib.sha256((u.urlparse(v[k]).password or "").encode()).hexdigest()[:10] for k in ("DATABASE_URL","REDIS_URL")])'; done
```

Si los hashes de production y staging coinciden, **staging apunta a producción**: detén los deploys de staging.

## Usuario semilla de staging

> **Desde el Bloque C (28-sep-2026) esto ya NO corre contra staging:** `seed-user`, `seed-org`,
> `seed-inbox` y `seed-contactos` solo aceptan una base LOCAL de desarrollo (guarda de
> `scripts/lib/base-local.ts`, la misma de `reset-db`), porque ya se corrieron por error en producción.
> Staging ya está sembrado; los usuarios nuevos se crean en Configuración › Vendedores. Si algún día
> hay que arrancar un staging vacío, se decide aparte. Lo de abajo queda como registro.

Staging arrancó vacío. Para crear el usuario y la organización se corrió esto desde la raíz del repo.
La base de staging se alcanza por su TCP proxy público, y el script pide email y password sin mostrarlos:

```bash
export DATABASE_URL="$(railway variable list -s Postgres -e staging --json | python3 -c 'import json,sys,urllib.parse as u; v=json.load(sys.stdin); q=lambda k: u.quote(v[k], safe=""); sys.stdout.write("postgresql://%s:%s@%s:%s/%s?sslmode=require" % (q("PGUSER"), q("PGPASSWORD"), v["RAILWAY_TCP_PROXY_DOMAIN"], v["RAILWAY_TCP_PROXY_PORT"], q("PGDATABASE")))')" APP_URL=https://crm-diluvium-staging.up.railway.app
read -r "SEED_USER_EMAIL?Email staging: "; read -rs "SEED_USER_PASSWORD?Password staging (min 12): "; echo; export SEED_USER_EMAIL SEED_USER_PASSWORD
npx tsx scripts/seed-user.ts && SEED_ORG_OWNER_EMAIL="$SEED_USER_EMAIL" npx tsx scripts/seed-org.ts
unset DATABASE_URL SEED_USER_EMAIL SEED_USER_PASSWORD
```

(Esa sintaxis de `read` es de zsh. En bash: `read -rp "Email: " SEED_USER_EMAIL`.)

**No dejes `SEED_USER_PASSWORD` como variable del servicio web.** Solo la usa el script de seed; la
app no la lee. Si queda en el servicio, cualquier proceso del web, dependencia u operador con acceso
a las variables ve una credencial de owner válida. Guárdala solo en tu gestor de contraseñas.

Si ya la cargaste en Railway, bórrala después del seed y cambia esa password:

```bash
railway variable delete SEED_USER_PASSWORD -s crm-diluvium -e staging
```
