# Respaldos de la base de datos

Railway está en plan trial: los backups nativos y el PITR son del plan Pro. Mientras tanto,
la BD de producción se respalda con `pg_dump` desde GitHub Actions
(`.github/workflows/db-backup.yml`). Las fotos, audios y PDF del bucket de media tienen su propio
respaldo diario (*Respaldo de medios*, abajo) y los datos crudos de los webhooks tienen retención
(*Retención de datos crudos*).

## Cómo funciona

- Todos los días a las 03:17 (hora de CDMX), y a mano desde *Actions → db-backup → Run workflow*.
- `pg_dump -Fc` contra la URL **pública** de la Postgres de producción (el TCP proxy de
  Railway), con un rol de **solo lectura** (`backup_ro`) y TLS **autenticado**
  (`sslmode=verify-ca` contra la CA fijada en `.github/backup/prod-postgres-root-ca.pem`, ver
  *TLS: CA fijada*).
- Antes de guardar el dump se **restaura de prueba** en un Postgres 18 desechable del mismo job
  y se compara el número de tablas con producción. Si no coincide, el job falla.
- El dump se cifra con **llave pública** (GPG, `.github/backup/respaldos-public.asc`, huella
  `56FD 4293 5662 F365 8B6B B1D9 9DE7 9FB8 CE0F 5C3A`). El job solo puede cifrar: descifra únicamente
  quien tenga la **llave privada**, que vive en el gestor de contraseñas del dueño y en ningún lado de
  GitHub ni Railway. Si el archivo o los secrets del CI se filtraran, nadie podría leer el respaldo.
- Se guarda en el bucket **privado** `crm-respaldos` de Railway (production, carpeta `respaldos/`), con
  credenciales propias de ese bucket (no las del bucket de media). **El repo es público:** por eso ya NO
  se sube como artifact (los artifacts de un repo público los descarga cualquier cuenta de GitHub).
- Retención: el propio job borra del bucket los respaldos con más de 90 días.

**Cambio del 29-sep-2026 (en producción desde el 30-sep, main 6161a15):** hasta esa fecha el respaldo iba
cifrado con passphrase (AES256, simétrico) a un artifact del repo público. El 30-sep se borraron los 46
artifacts viejos y el secret `BACKUP_GPG_PASSPHRASE` (decisión del dueño): hoy los respaldos existen solo
en el bucket y se abren solo con la llave privada.

## Monitoreo: que el respaldo no se apague en silencio

Sin herramientas externas, a propósito: el CRM solo depende de GitHub y Railway.

- **Si el job falla**, GitHub le manda un correo a quien editó el cron por última vez.
- **Si el job deja de correr**, GitHub no avisa. Pasa, por ejemplo, porque desactiva los workflows
  programados de un repo público tras **60 días sin actividad** (commits, PRs), y al no haber corrida
  fallida no hay correo. Si nadie lo nota, a los 90 días caducan todos los respaldos.
  Con el repo en desarrollo activo no ocurre, porque cada push reinicia el contador. Si el proyecto
  se congela, revisa *Actions → db-backup* al menos una vez al mes. Si está desactivado:
  *Enable workflow* y *Run workflow*.

## Secrets

Viven en el environment **`production-backup`** de GitHub, que solo entrega secrets a jobs que
corren desde `main`. Un workflow modificado en otra rama y lanzado con `workflow_dispatch` no
los recibe. **No los dejes a nivel de repo:** esos sí los recibe cualquier rama.

**Verifica que esa restricción está activa antes de cargar secrets.** El `environment:` del workflow
solo *referencia* el environment; la restricción a `main` es una configuración aparte en GitHub. Si
falta, cualquier rama recibe los secrets:

```bash
gh api repos/Diluvium-mx/crm-diluvium/environments/production-backup --jq .deployment_branch_policy && gh api repos/Diluvium-mx/crm-diluvium/environments/production-backup/deployment-branch-policies --jq '.branch_policies[] | "\(.type): \(.name)"'
```

Debe mostrar `"custom_branch_policies": true` y una sola política, `branch: main`. Si no, corrígelo en
*Settings → Environments → production-backup → Deployment branches and tags*, en **Selected branches
and tags** con solo `main`. Verificado el 18-sep-2026.

| Secret | Qué es |
|---|---|
| `PROD_DATABASE_URL` | URL pública de producción con el rol `backup_ro`: `postgresql://backup_ro:PASS@<RAILWAY_TCP_PROXY_DOMAIN>:<RAILWAY_TCP_PROXY_PORT>/<PGDATABASE>?sslmode=require`. El job la desarma en variables `PG*`: la contraseña nunca va como argumento de un comando. |
| `RESPALDOS_S3_BUCKET` | Nombre S3 del bucket `crm-respaldos` (lo da `railway bucket credentials --bucket crm-respaldos -e production --json`, campo `bucketName`). |
| `RESPALDOS_S3_ACCESS_KEY_ID` / `RESPALDOS_S3_SECRET_ACCESS_KEY` | Credenciales de ESE bucket (mismo comando). Se cargan con `gh secret set … --env production-backup` directo desde la salida del comando, sin pasar por pantalla. |

### Llave de cifrado

- **Pública** (`.github/backup/respaldos-public.asc`): versionada. El workflow comprueba su huella
  (`RESPALDOS_FPR`) antes de cifrar: si alguien cambiara el archivo, el job falla en vez de cifrar para
  un desconocido.
- **Privada**: SOLO en el gestor de contraseñas del dueño (se generó el 29-sep-2026 en su Mac y se le
  entregó como archivo `CRM-Diluvium-llave-privada-respaldos.asc` para guardarla ahí y borrar el archivo).
  Sin ella no hay restore. No lleva contraseña propia: el gestor es su protección.
- **Rotación** (si la privada se pierde o se filtra): generar otro par, sustituir la pública en el repo y
  la huella en el workflow, y mezclar a `main`. Los respaldos anteriores siguen cifrados con la llave
  vieja: consérvala mientras existan.

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

4. Carga las credenciales del bucket de respaldos en el environment, directo desde Railway (sin que
   pasen por pantalla ni por el portapapeles):

   ```bash
   railway bucket credentials --bucket crm-respaldos -e production --json > /tmp/rb.json && gh secret set RESPALDOS_S3_BUCKET --env production-backup --body "$(jq -r .bucketName /tmp/rb.json)" && gh secret set RESPALDOS_S3_ACCESS_KEY_ID --env production-backup --body "$(jq -r .accessKeyId /tmp/rb.json)" && gh secret set RESPALDOS_S3_SECRET_ACCESS_KEY --env production-backup --body "$(jq -r .secretAccessKey /tmp/rb.json)" && rm -P /tmp/rb.json
   ```

5. Borra las copias a nivel de repo (si las hubiera) y limpia el portapapeles:

   ```bash
   gh secret delete PROD_DATABASE_URL 2>/dev/null; echo -n | pbcopy
   ```

6. Lanza el workflow a mano (*Run workflow*) y confirma que pasa y que el archivo aparece en el bucket
   (*Railway → production → crm-respaldos*).

### TLS: CA fijada

`sslmode=require` solo cifra: no comprueba con quién habla, así que un atacante en la red o en el DNS
podría hacerse pasar por el proxy y recibir la credencial y el dump en claro. El Postgres de Railway
firma su certificado con una CA **propia de la instancia** (`CN=root-ca`). El certificado es para
`localhost` y `postgres.railway.internal`, no para el dominio del proxy, así que `verify-full` no
aplica. El workflow usa `verify-ca` contra esa CA fijada en `.github/backup/prod-postgres-root-ca.pem`.

- Huella SHA-256 fijada el 18-sep-2026:
  `55:2E:ED:5A:B7:FF:39:53:7C:92:FF:F1:97:83:BA:F8:5E:DD:93:CB:09:E8:5F:BE:C4:14:9C:DA:AD:A4:52:78`
  (válida hasta el 10-dic-2028).
- Si Railway regenera el certificado (volumen nuevo, reinstalación del servicio o vencimiento), el
  job falla con un error de certificado. **No lo "arregles" volviendo a `require`.** Vuelve a fijar la CA
  desde una red de confianza y revisa el cambio antes de mergearlo:

  ```bash
  echo | openssl s_client -starttls postgres -connect "$(railway tcp-proxy list --service Postgres -e production --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["proxies"][0]["endpoint"])')" -showcerts 2>/dev/null | awk '/BEGIN CERTIFICATE/{n++} n==2' | sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' > .github/backup/prod-postgres-root-ca.pem && openssl x509 -in .github/backup/prod-postgres-root-ca.pem -noout -subject -dates -fingerprint -sha256
  ```

  Compara la huella con la que muestra el propio servidor desde dentro de Railway
  (`railway ssh -s Postgres` → `openssl x509 -in <ruta del CA> -noout -fingerprint -sha256`)
  antes de dar por buena la nueva.

## Restore

`pg_restore --clean` sobre la base en uso **no** da una copia exacta: solo borra los objetos que
están en el dump. Lo que se creó después del respaldo (tablas o índices de migraciones nuevas)
sobrevive, puede bloquear el drop de lo demás y deja `drizzle.__drizzle_migrations` desalineado
con el schema real. Por eso el restore va **a una base nueva y limpia**, se valida, y después se
intercambia por la actual.

> **Ensaya primero en staging** (mismo procedimiento con `-e staging`). En producción la app
> queda caída durante el intercambio (paso 7).

Requisitos: `gpg`, el cliente de Postgres 18 y el cliente de S3 (`brew install gnupg postgresql@18 awscli`).
La carpeta `restore/` está en `.gitignore`: el dump en claro nunca debe llegar al repo.

1. Importa tu llave privada (una sola vez por Mac) desde el gestor de contraseñas: pega su contenido en
   un archivo temporal, impórtalo y bórralo:

   ```bash
   gpg --import ~/Desktop/CRM-Diluvium-llave-privada-respaldos.asc && rm -P ~/Desktop/CRM-Diluvium-llave-privada-respaldos.asc
   ```

2. Lista los respaldos del bucket y descarga el que quieras. Las credenciales salen de Railway y solo
   viven en esa terminal:

   ```bash
   eval "$(railway bucket credentials --bucket crm-respaldos -e production --json | jq -r '"export AWS_ACCESS_KEY_ID=\(.accessKeyId) AWS_SECRET_ACCESS_KEY=\(.secretAccessKey) RB=\(.bucketName) AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required"')" && aws --endpoint-url https://t3.storageapi.dev s3 ls "s3://$RB/respaldos/"
   ```

   ```bash
   mkdir -p restore && aws --endpoint-url https://t3.storageapi.dev s3 cp "s3://$RB/respaldos/crm-diluvium-prod-<fecha>.dump.gpg" restore/
   ```

3. Descifra con tu llave privada y revisa el contenido:

   ```bash
   gpg --decrypt -o restore/backup.dump restore/crm-diluvium-prod-*.dump.gpg
   ```

   ```bash
   pg_restore --list restore/backup.dump | head -40
   ```

4. Toma la URL de administración del environment destino (usuario `postgres`, **no** `backup_ro`)
   apuntando a la base de mantenimiento `postgres`. Con TLS **autenticado** (`verify-ca` contra la CA
   fijada; `require` solo cifra y un MITM recibiría la credencial del superusuario):

   ```bash
   export PGSSLMODE=verify-ca PGSSLROOTCERT="$PWD/.github/backup/prod-postgres-root-ca.pem" ADMIN_URL="$(railway variable list -s Postgres -e staging --json | python3 -c 'import json,sys,urllib.parse as u; v=json.load(sys.stdin); q=lambda k: u.quote(v[k], safe=""); sys.stdout.write("postgresql://%s:%s@%s:%s/postgres" % (q("PGUSER"), q("PGPASSWORD"), v["RAILWAY_TCP_PROXY_DOMAIN"], v["RAILWAY_TCP_PROXY_PORT"]))')"
   ```

   (La CA fijada es la de **producción**; para staging fija la suya con el comando de *TLS: CA fijada*
   sobre `-e staging`, o usa `railway connect Postgres -e staging`, que va por la red privada.)

5. Crea una base **limpia** desde `template0` y restaura ahí:

   ```bash
   psql "$ADMIN_URL" -c 'CREATE DATABASE railway_restore TEMPLATE template0'
   ```

   ```bash
   pg_restore --no-owner --no-acl --single-transaction --exit-on-error -d "${ADMIN_URL%/postgres*}/railway_restore" restore/backup.dump
   ```

6. Valida la base restaurada: tablas, conteos de filas de `contacts`, `user`, `organization` y la
   última migración en `drizzle.__drizzle_migrations`. Si algo no cuadra, bórrala
   (`DROP DATABASE railway_restore`) y no sigas.

7. Intercambio. Detén el web primero, para que no escriba durante el cambio:

   ```bash
   railway down -s crm-diluvium -e staging
   ```

   Los dos `RENAME` van en **una sola transacción** (`--single-transaction`; `ALTER DATABASE … RENAME`
   sí es transaccional). Si algo falla a la mitad, no se aplica nada y `railway` sigue siendo la base
   original. El bloque `DO` aborta antes de tocar nada si los nombres no son los esperados:

   ```bash
   psql "$ADMIN_URL" --single-transaction -v ON_ERROR_STOP=1 <<'SQL'
   DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'railway') THEN RAISE EXCEPTION 'no existe la base railway'; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'railway_restore') THEN RAISE EXCEPTION 'no existe railway_restore'; END IF;
     IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'railway_pre_restore') THEN RAISE EXCEPTION 'ya existe railway_pre_restore: bórrala o renómbrala antes'; END IF;
   END $$;
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('railway', 'railway_restore') AND pid <> pg_backend_pid();
   ALTER DATABASE railway RENAME TO railway_pre_restore;
   ALTER DATABASE railway_restore RENAME TO railway;
   SQL
   ```

   Comprueba el resultado. Deben aparecer `railway` y `railway_pre_restore`, y ya no `railway_restore`:

   ```bash
   psql "$ADMIN_URL" -XAtc "select datname from pg_database where datname like 'railway%' order by 1"
   ```

   Después vuelve a desplegar el web (*Redeploy* en Railway, o un push a la rama del environment).
   El deploy corre `drizzle-kit migrate`, que aplica solo las migraciones que falten.

   **Rollback** (si la app no funciona con la base restaurada): detén el web y deshaz el intercambio,
   también en una sola transacción:

   ```bash
   psql "$ADMIN_URL" --single-transaction -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('railway', 'railway_pre_restore') AND pid <> pg_backend_pid()" -c "ALTER DATABASE railway RENAME TO railway_restore_fallido" -c "ALTER DATABASE railway_pre_restore RENAME TO railway"
   ```

8. Verifica la app. Conserva `railway_pre_restore` unos días como vuelta atrás; después bórrala
   (`DROP DATABASE railway_pre_restore`). Borra los archivos locales:

   ```bash
   rm -rf restore/ && unset ADMIN_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY RB
   ```

El rol `backup_ro` (`pg_read_all_data`) es del servidor, no de la base, así que los respaldos
siguen funcionando después del intercambio.

## Respaldo de medios

Las fotos, audios, videos y PDF (mensajes, adjuntos del chat, Biblioteca, miniaturas de anuncios) viven
en el bucket de media de producción, el que el web `crm-diluvium` usa en `S3_BUCKET`. Se respaldan con
`.github/workflows/media-backup.yml`.

- **Cuándo:** todos los días a las **04:17** (hora de CDMX), una hora después del de la base, y a mano
  desde *Actions → media-backup → Run workflow*.
- **Qué hace:** `rclone sync` del bucket de media a `crm-respaldos`, carpeta **`media/`** (misma ruta de
  cada archivo). Copia solo lo **nuevo o cambiado** (tamaño y MD5 cuando el bucket lo da) y **borra del
  respaldo lo que ya no está en producción**: cuando se borra un contacto (derechos ARCO), sus archivos
  salen del respaldo en la siguiente corrida (≤ 24 h). No hay versiones viejas: el respaldo es un espejo
  de ayer.
- **Del bucket de media solo lee.** rclone 1.75.1 fijado por versión y sha256; las credenciales van por
  variables de entorno.
- **Sin nombres de archivo en el log** (el repo y sus logs son públicos; las rutas llevan ids y a veces
  el nombre que puso el cliente). El resumen del job (*Summary*) dice cuántos archivos se copiaron y
  cuánto pesan, cuántos se borraron y el total del respaldo. Si algo falla, el job sale en rojo y GitHub
  manda correo.
- **Candado:** si producción tiene menos de la mitad de los archivos que ya hay en el respaldo, no
  sincroniza (un bucket equivocado borraría el respaldo). Si de verdad se borró tanto, córrelo a mano con
  la casilla **permitir_borrado_masivo**.
- No va cifrado aparte (a diferencia del dump): el bucket `crm-respaldos` es privado y quien tenga las
  credenciales del CI ya puede leer los originales.
- Monitoreo: igual que el de la base (*Monitoreo*, arriba); si GitHub apaga los workflows programados,
  reactiva también este.

### Secrets del respaldo de medios

Van en el mismo environment **`production-backup`** (solo `main`; ver *Secrets*). Los tres
`RESPALDOS_S3_*` ya existen (los usa el respaldo de la base). Faltan cuatro, del bucket de media de
**producción**; cada valor sale de una variable del servicio web `crm-diluvium` en Railway
(environment `production`):

| Secret | Variable de Railway (`crm-diluvium`, production) |
|---|---|
| `MEDIA_S3_BUCKET` | `S3_BUCKET` |
| `MEDIA_S3_ENDPOINT` | `S3_ENDPOINT` |
| `MEDIA_S3_ACCESS_KEY_ID` | `S3_ACCESS_KEY_ID` |
| `MEDIA_S3_SECRET_ACCESS_KEY` | `S3_SECRET_ACCESS_KEY` |

Si Railway ofrece credenciales de **solo lectura** para ese bucket, usa esas en lugar de las del web.

Para cada uno: copia el valor al portapapeles (desde *Railway → crm-diluvium → production → Variables*,
o con el primer comando, que no lo muestra en pantalla) y cárgalo con el segundo:

```bash
railway variable list -s crm-diluvium -e production --json | jq -r .S3_BUCKET | tr -d '\n' | pbcopy
pbpaste | gh secret set MEDIA_S3_BUCKET --env production-backup
```

```bash
railway variable list -s crm-diluvium -e production --json | jq -r .S3_ENDPOINT | tr -d '\n' | pbcopy
pbpaste | gh secret set MEDIA_S3_ENDPOINT --env production-backup
```

```bash
railway variable list -s crm-diluvium -e production --json | jq -r .S3_ACCESS_KEY_ID | tr -d '\n' | pbcopy
pbpaste | gh secret set MEDIA_S3_ACCESS_KEY_ID --env production-backup
```

```bash
railway variable list -s crm-diluvium -e production --json | jq -r .S3_SECRET_ACCESS_KEY | tr -d '\n' | pbcopy
pbpaste | gh secret set MEDIA_S3_SECRET_ACCESS_KEY --env production-backup
```

Al terminar, limpia el portapapeles y confirma que están los siete:

```bash
echo -n | pbcopy; gh secret list --env production-backup
```

Después del merge a `main`, lánzalo a mano (*Run workflow*). La primera corrida copia todo y tarda más;
las siguientes, solo lo del día. Confirma en el *Summary* que el total del respaldo coincide con
producción.

### Restaurar medios

Requisitos: `brew install rclone jq`. Las credenciales salen de Railway y solo viven en esa terminal.
Prepara los dos remotos (`respaldos:` y `media:`, el bucket de media de producción):

```bash
eval "$(railway bucket credentials --bucket crm-respaldos -e production --json | jq -r '"export RCLONE_CONFIG_RESPALDOS_TYPE=s3 RCLONE_CONFIG_RESPALDOS_PROVIDER=Other RCLONE_CONFIG_RESPALDOS_REGION=auto RCLONE_CONFIG_RESPALDOS_FORCE_PATH_STYLE=false RCLONE_CONFIG_RESPALDOS_ENDPOINT=https://t3.storageapi.dev RCLONE_CONFIG_RESPALDOS_ACCESS_KEY_ID=\(.accessKeyId) RCLONE_CONFIG_RESPALDOS_SECRET_ACCESS_KEY=\(.secretAccessKey) RB=\(.bucketName)"')"
```

```bash
eval "$(railway variable list -s crm-diluvium -e production --json | jq -r '"export RCLONE_CONFIG_MEDIA_TYPE=s3 RCLONE_CONFIG_MEDIA_PROVIDER=Other RCLONE_CONFIG_MEDIA_REGION=auto RCLONE_CONFIG_MEDIA_FORCE_PATH_STYLE=false RCLONE_CONFIG_MEDIA_ENDPOINT=\(.S3_ENDPOINT) RCLONE_CONFIG_MEDIA_ACCESS_KEY_ID=\(.S3_ACCESS_KEY_ID) RCLONE_CONFIG_MEDIA_SECRET_ACCESS_KEY=\(.S3_SECRET_ACCESS_KEY) MB=\(.S3_BUCKET)"')"
```

**Un archivo.** La ruta es la misma en los dos buckets (`org/<org>/messages/<mensaje>/…`; la del mensaje
sale de `messages.attachments[].storageKey`). Búscala y cópiala de vuelta:

```bash
rclone lsf -R "respaldos:$RB/media/org/<org>/messages/<mensaje>/"
```

```bash
rclone copyto "respaldos:$RB/media/<ruta>" "media:$MB/<ruta>"
```

**Todo.** Con `copy` (nunca `sync`: no borra nada de producción). Primero en seco, revisa y después de
verdad:

```bash
rclone copy "respaldos:$RB/media" "media:$MB" --checksum --dry-run
```

```bash
rclone copy "respaldos:$RB/media" "media:$MB" --checksum --transfers 8 --progress
```

Al terminar: `unset RB MB $(env | grep -o '^RCLONE_CONFIG_[A-Z_]*')`.

> Antes de restaurar en producción, ensaya contra el bucket de staging (mismos comandos con `-e staging`
> en el segundo `eval`).

## Retención de datos crudos (webhook_events)

`webhook_events` guarda el payload **crudo** de cada webhook de Zernio (teléfono, nombre y texto del
cliente) para no perder nada y poder reprocesar. No se guarda para siempre (barrido del worker, cada
minuto):

- **Procesados:** se borran a los **30 días** de `processed_at`.
- **Cuarentena** (cuenta no permitida en el entorno): se borran a los **30 días** de `quarantined_at`.
- **Dead-letter** (agotó sus intentos o formato no reconocido): a los **30 días** de `dead_lettered_at`
  se **vacía el payload** (queda `{"_vaciado": "<fecha>"}`). La fila se queda —id, evento, intentos,
  `last_error`, fechas— para que el monitor y los conteos sigan igual; solo deja de tener los datos del
  cliente. `npm run webhooks:replay` reactiva los demás y **salta** los vaciados con un aviso (siguen en
  dead-letter), y la ingesta tampoco intenta procesarlos. Lógica:
  `lib/messaging/dead-letter-retention.ts`. Si un dead-letter importa, hay que reprocesarlo antes de
  esos 30 días.

## Cuándo cambiar a Railway Pro

Cuando entren datos reales de volumen (Fase 2, WhatsApp): PITR da recuperación a cualquier minuto;
este respaldo solo da la foto de hace ≤24 h. Al migrar, borrar el TCP proxy público de la
Postgres si ya nada lo usa (`railway tcp-proxy list --service Postgres`).
