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
  El push también **prende** staging si estaba apagado (sección siguiente).
- **Nunca** «Deploy Latest Commit» (Cmd+K) ni un deploy por API sin commit en staging: toman la rama por
  defecto del repo (`main`). Así el web de staging recibió `main` el 23, 24 y 27-oct-2026 (de1c567, 89312a2,
  b723cc2) hasta el siguiente push a `staging`. Para prender staging sin subir nada: `npm run staging:encender`.

## Encender y apagar staging (ahorro de Railway, OK del dueño 28-oct-2026)

Staging solo se usa unas horas a la semana (16 h con visitas del 21 al 28-oct) y prendido todo el tiempo costaba
≈ US$4.9 al mes (worker ≈ 2.4, web ≈ 1.5, Postgres ≈ 0.9, Redis ≈ 0.2; memoria promedio de 7 días a US$10/GB-mes).
Por eso **el web y el worker de staging se apagan solos** cuando nadie los usa; **Postgres y Redis siempre siguen
prendidos** (≈ US$1 al mes), así una subida nunca falla por la base apagada y no se pierde nada.

| Qué | Cómo |
|---|---|
| Prender | Solo: cada push a `staging` crea un despliegue nuevo. Sin subir nada: `npm run staging:encender` (la misma versión de `staging`, sin reconstruir; responde en 1–2 min) |
| Apagar | Solo: `.github/workflows/staging-apagado.yml` revisa cada hora y apaga el web y el worker si llevan **2 h sin visitas ni subidas**. Ya: `npm run staging:apagar` |
| Ver cómo está | `npm run staging:estado` (prendido/apagado, versión, última subida y última visita en hora de Mazatlán) |
| Ver qué haría | cualquiera con `-- --probar` |

- Script: `scripts/staging-energia.ts` (sin dependencias; la lógica tiene pruebas en `staging-energia.test.ts`).
  Solo conoce los IDs del environment staging y los comprueba antes de apagar o prender: producción nunca.
  «Apagar» quita el despliegue activo (Railway › Remove). «Prender» vuelve a desplegar la imagen del último
  despliegue de la rama `staging` (nunca uno de `main`).
- Desde la Mac usa el login del CLI `railway`. En GitHub usa el secret **`RAILWAY_STAGING_TOKEN`**: un token de
  **proyecto** de Railway creado para el environment staging (no puede tocar producción; el script se detiene si
  el token es de otro environment). GitHub solo corre los horarios desde `main` y los pausa tras 60 días sin
  actividad en el repo.
- Mientras está apagado: la URL de staging muestra un error de Railway (se pide «prende staging»), y los mensajes
  programados y seguimientos de prueba de staging no salen hasta prenderlo. Una pestaña abierta en staging que
  sigue haciendo peticiones cuenta como visita y lo mantiene prendido.
- Para dejarlo prendido más tiempo (p. ej. probar un seguimiento programado para mañana), basta con volver a
  correr `npm run staging:encender` cuando haga falta; no hay interruptor para pausar la revisión.
- Por qué no el «Serverless» (App Sleeping) de Railway: duerme un servicio solo si no manda ningún paquete en
  5–10 min, y el web deja abiertas sus conexiones a Postgres (`postgres` manda señal cada 60 s, el LISTEN de la
  bandeja no se cierra) y a Redis (`ioredis`, cada 30 s); el worker lee Redis sin parar. Nunca se dormirían.

## Al llegar a `main`: etiqueta y rama borrada (regla del dueño, 9-oct-2026)

En cuanto una rama entra a `main` (merge con «OK MAIN» + push), **en el mismo momento**, desde la copia principal:

```
npm run rama:cerrar -- <rama>            # --probar para ver qué haría sin hacerlo
```

1. Comprueba que todo lo de la rama ya está en `origin/main`; si no, se detiene sin tocar nada.
2. Pone la etiqueta del pase a producción `prod-AAAA-MM-DD-<rama sin prefijo>` (fecha de Mazatlán) en el commit con
   el que entró y la sube a GitHub. `git tag -l "prod-*"` lista lo que ha salido a producción y en qué orden.
3. Quita el worktree de la rama (si tiene cambios sin guardar, se detiene y avisa).
4. Borra la rama en GitHub y en local.

Así en GitHub solo quedan `main`, `staging` y las ramas en curso. Una rama que todavía no llega a `main` (pendiente o
solo en staging) no se borra. Las ramas de Dependabot las cierra GitHub al mezclar o cerrar su PR.

## Protección de `main` en GitHub

Desde el 8-oct-2026 hay un ruleset en `main` («main: sin force-push ni borrado»): nadie puede reescribir ni borrar
la rama. No exige PR ni checks. Si algún día hay que reescribir la historia (como en S6), se desactiva a propósito en
GitHub › Settings › Rules › Rulesets y se vuelve a prender al terminar.

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

## Cliente de prueba (30-oct-2026, pedido del dueño)

En la Bandeja de staging siempre está **«Cliente de prueba»** (canal «Simulador (staging)», marcado PRUEBA): se crea
solo al abrir la Bandeja (`asegurarClienteDePrueba`) y su ventana de 24 h nunca cierra, así que la caja para escribir
nunca pide plantilla. Arriba de la caja, solo en su chat, está la barra 🧪:

- **Escribe como el cliente…** + **Mandar como cliente**: el mensaje entra por el mismo camino que un webhook de Zernio
  (`webhook_events` + cola de entrantes), así que el Agente IA (modelos reales: unos centavos por prueba), el lector, los
  workflows por palabra clave y los seguimientos se comportan igual que con un cliente de verdad.
- Lo que se le manda (vendedor, ⚡, Agente IA, workflows, archivos) se marca como enviado **sin llamar a Zernio**
  (`conSimulador` en `lib/messaging/index.ts`): nada sale a WhatsApp.
- **Empezar de nuevo**: borra su chat, Detalle y seguimientos y lo deja como nuevo (el Agente IA lee todo el chat; para
  probar una venta desde cero hay que empezar limpio).

Solo existe donde `simuladorActivo()`: staging en Railway (`RAILWAY_ENVIRONMENT_NAME=staging`) o local sin Railway. En
producción no se crea, no aparece la barra y la cuenta simulada no tiene nada especial. Su número (+52 668 000 0000) es
de México: para probar el candado de lada extranjera hace falta un contacto con otra lada.

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
