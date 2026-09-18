# Respaldos de la base de datos

Railway está en plan trial: los backups nativos y el PITR son del plan Pro. Mientras tanto,
la BD de producción se respalda con `pg_dump` desde GitHub Actions
(`.github/workflows/db-backup.yml`).

## Cómo funciona

- Todos los días a las 03:17 (hora de CDMX), y a mano desde *Actions → db-backup → Run workflow*.
- `pg_dump -Fc` contra la URL **pública** de la Postgres de producción (el TCP proxy de
  Railway), siempre con `sslmode=require` y con un rol de **solo lectura** (`backup_ro`).
- Antes de guardar el dump se **restaura de prueba** en un Postgres 18 desechable del mismo job
  y se compara el número de tablas con producción. Si no coincide, el job falla.
- El dump se cifra con GPG (AES256, simétrico) y se sube como artifact. **El repo es público:**
  cualquier cuenta de GitHub puede descargar el artifact, así que sin la passphrase no sirve de nada.
- Retención: 90 días, el máximo de GitHub para repos públicos.

## Monitoreo: que el respaldo no se apague en silencio

- **Si el job falla**, GitHub le manda un correo a quien editó el cron por última vez.
- **Si el job deja de correr**, GitHub no avisa. Pasa, por ejemplo, porque desactiva los workflows
  programados de un repo público tras **60 días sin actividad**, y al no haber corrida fallida no hay correo.
  Si nadie lo nota, a los 90 días caducan todos los respaldos.

Para cubrir el segundo caso, el último paso del job hace ping a un *dead-man switch*: un servicio
externo que alerta cuando el ping **no** llega. Configúralo así:

1. Crea un check en [healthchecks.io](https://healthchecks.io) (gratis): period **1 día**, grace **6 horas**,
   con alerta a tu correo o WhatsApp.
2. Guarda su URL de ping como secret del environment:

   ```bash
   gh secret set BACKUP_HEARTBEAT_URL --env production-backup
   ```

Sin ese secret, el job muestra un warning en cada corrida.

Si llega la alerta: *Actions → db-backup → Enable workflow* (si está desactivado) y *Run workflow*.

## Secrets

Viven en el environment **`production-backup`** de GitHub, que solo entrega secrets a jobs que
corren desde `main`. Un workflow modificado en otra rama y lanzado con `workflow_dispatch` no
los recibe. **No los dejes a nivel de repo:** esos sí los recibe cualquier rama.

| Secret | Qué es |
|---|---|
| `PROD_DATABASE_URL` | URL pública de producción con el rol `backup_ro`: `postgresql://backup_ro:PASS@<RAILWAY_TCP_PROXY_DOMAIN>:<RAILWAY_TCP_PROXY_PORT>/<PGDATABASE>?sslmode=require` |
| `BACKUP_GPG_PASSPHRASE` | Mínimo 32 caracteres. **Guárdala en tu gestor de contraseñas:** GitHub no deja leer un secret, así que si solo existe ahí no hay restore. |
| `BACKUP_HEARTBEAT_URL` | Opcional (ver *Monitoreo*). |

### Rol de solo lectura `backup_ro`

`pg_dump` no necesita escribir. Con el rol `backup_ro`, un secret filtrado permite leer, no borrar
ni modificar.

1. Genera la password y déjala en el portapapeles:

   ```bash
   openssl rand -hex 32 | tr -d '\n' | pbcopy
   ```

2. Crea el rol. Abre `psql` en producción (requiere `brew install postgresql@18`):

   ```bash
   railway connect Postgres -e production
   ```

   Y dentro de `psql`:

   ```sql
   CREATE ROLE backup_ro WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 3;
   GRANT pg_read_all_data TO backup_ro;
   \password backup_ro
   ```

   `\password` pide la password: pégala con Cmd+V dos veces. Sal con `\q`.

3. Guarda la URL en el environment. Toma la password del portapapeles, sin mostrarla:

   ```bash
   railway variable list -s Postgres -e production --json | BACKUP_PW="$(pbpaste)" python3 -c 'import json,os,sys,urllib.parse as u; v=json.load(sys.stdin); sys.stdout.write("postgresql://backup_ro:%s@%s:%s/%s?sslmode=require" % (u.quote(os.environ["BACKUP_PW"], safe=""), v["RAILWAY_TCP_PROXY_DOMAIN"], v["RAILWAY_TCP_PROXY_PORT"], u.quote(v["PGDATABASE"], safe="")))' | gh secret set PROD_DATABASE_URL --env production-backup
   ```

4. Pasa la passphrase al environment, **la misma** que ya tienes guardada (no generes otra, o los
   respaldos existentes quedan sin poder descifrarse). El comando la pide; pégala desde tu gestor:

   ```bash
   gh secret set BACKUP_GPG_PASSPHRASE --env production-backup
   ```

5. Borra las copias a nivel de repo y limpia el portapapeles:

   ```bash
   gh secret delete PROD_DATABASE_URL && gh secret delete BACKUP_GPG_PASSPHRASE && echo -n | pbcopy
   ```

6. Lanza el workflow a mano (*Run workflow*) y confirma que pasa.

## Restore

`pg_restore --clean` sobre la base en uso **no** da una copia exacta: solo borra los objetos que
están en el dump. Lo que se creó después del respaldo (tablas o índices de migraciones nuevas)
sobrevive, puede bloquear el drop de lo demás y deja `drizzle.__drizzle_migrations` desalineado
con el schema real. Por eso el restore va **a una base nueva y limpia**, se valida, y después se
intercambia por la actual.

> **Ensaya primero en staging** (mismo procedimiento con `-e staging`). En producción la app
> queda caída durante el intercambio (paso 6).

Requisitos: `gh`, `gpg` y el cliente de Postgres 18 (`brew install gnupg postgresql@18`).

1. Descarga el respaldo. Toma el `run-id` de *Actions → db-backup*, o del listado:

   ```bash
   gh run list --workflow db-backup.yml --limit 10
   ```

   ```bash
   gh run download <run-id> --dir restore/
   ```

2. Descifra (pide la passphrase) y revisa el contenido:

   ```bash
   gpg --decrypt -o restore/backup.dump restore/*/crm-diluvium-prod-*.dump.gpg
   ```

   ```bash
   pg_restore --list restore/backup.dump | head -40
   ```

3. Toma la URL de administración del environment destino (usuario `postgres`, **no** `backup_ro`)
   apuntando a la base de mantenimiento `postgres`:

   ```bash
   export ADMIN_URL="$(railway variable list -s Postgres -e staging --json | python3 -c 'import json,sys,urllib.parse as u; v=json.load(sys.stdin); q=lambda k: u.quote(v[k], safe=""); sys.stdout.write("postgresql://%s:%s@%s:%s/postgres?sslmode=require" % (q("PGUSER"), q("PGPASSWORD"), v["RAILWAY_TCP_PROXY_DOMAIN"], v["RAILWAY_TCP_PROXY_PORT"]))')"
   ```

4. Crea una base **limpia** desde `template0` y restaura ahí:

   ```bash
   psql "$ADMIN_URL" -c 'CREATE DATABASE railway_restore TEMPLATE template0'
   ```

   ```bash
   pg_restore --no-owner --no-acl --single-transaction --exit-on-error -d "${ADMIN_URL%/postgres*}/railway_restore?sslmode=require" restore/backup.dump
   ```

5. Valida la base restaurada: tablas, conteos de filas de `contacts`, `user`, `organization` y la
   última migración en `drizzle.__drizzle_migrations`. Si algo no cuadra, bórrala
   (`DROP DATABASE railway_restore`) y no sigas.

6. Intercambio. Detén el web primero, para que no escriba durante el cambio:

   ```bash
   railway down -s crm-diluvium -e staging
   ```

   ```bash
   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<'SQL'
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'railway' AND pid <> pg_backend_pid();
   ALTER DATABASE railway RENAME TO railway_pre_restore;
   ALTER DATABASE railway_restore RENAME TO railway;
   SQL
   ```

   Después vuelve a desplegar el web (*Redeploy* en Railway, o un push a la rama del environment).
   El deploy corre `drizzle-kit migrate`, que aplica solo las migraciones que falten.

7. Verifica la app. Conserva `railway_pre_restore` unos días como vuelta atrás; después bórrala
   (`DROP DATABASE railway_pre_restore`). Borra los archivos locales:

   ```bash
   rm -rf restore/ && unset ADMIN_URL
   ```

El rol `backup_ro` (`pg_read_all_data`) es del servidor, no de la base, así que los respaldos
siguen funcionando después del intercambio.

## Cuándo cambiar a Railway Pro

Cuando entren datos reales de volumen (Fase 2, WhatsApp): PITR da recuperación a cualquier minuto;
este respaldo solo da la foto de hace ≤24 h. Al migrar, borrar el TCP proxy público de la
Postgres si ya nada lo usa (`railway tcp-proxy list --service Postgres`).
