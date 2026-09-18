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
  - worker: `npm run start:worker` (= `tsx worker/index.ts`), build sin `next build`.
  El *Custom Start Command* de cada servicio en Railway debe ser exactamente ese script; al
  crear un servicio o un environment nuevo, es lo primero que se revisa.
- Para validar una rama, mérgala a `staging` y haz push. Cuando esté validada, abre el PR a `main`.

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

Staging arranca vacío. Para crear el usuario y la organización, corre esto desde la raíz del repo.
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
