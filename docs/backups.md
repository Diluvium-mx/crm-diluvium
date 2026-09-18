# Respaldos de la base de datos

Railway está en plan trial: los backups nativos y el PITR son del plan Pro. Mientras tanto,
la BD de producción se respalda con `pg_dump` desde GitHub Actions
(`.github/workflows/db-backup.yml`).

## Cómo funciona

- Todos los días a las 03:17 (hora de CDMX), y a mano desde *Actions → db-backup → Run workflow*.
- `pg_dump -Fc` contra la URL **pública** de la Postgres de producción (el TCP proxy de
  Railway), siempre con `sslmode=require`.
- Antes de guardar el dump se **restaura de prueba** en un Postgres 18 desechable del mismo job
  y se compara el número de tablas con producción. Si no coincide, el job falla.
- El dump se cifra con GPG (AES256, simétrico) y se sube como artifact. **El repo es público:**
  cualquier cuenta de GitHub puede descargar el artifact, así que sin la passphrase no sirve de nada.
- Retención: 90 días, el máximo de GitHub para repos públicos.
- Si el job falla, GitHub le manda un correo a quien editó el cron por última vez.
  **GitHub desactiva los workflows programados después de 60 días sin actividad en el repo.**

## Secrets

| Secret | Qué es |
|---|---|
| `PROD_DATABASE_URL` | `postgresql://USER:PASS@<RAILWAY_TCP_PROXY_DOMAIN>:<RAILWAY_TCP_PROXY_PORT>/<PGDATABASE>` de la Postgres de **producción** |
| `BACKUP_GPG_PASSPHRASE` | Mínimo 32 caracteres. **Guárdala también en tu gestor de contraseñas:** GitHub no deja leer un secret una vez guardado, así que si solo existe ahí no hay restore. |

Para cargarlos sin que el valor aparezca en pantalla ni en el historial, corre esto desde la raíz del repo (con `railway` enlazado al proyecto):

```bash
railway variable list -s Postgres -e production --json | python3 -c 'import json,sys,urllib.parse as u; v=json.load(sys.stdin); q=lambda k: u.quote(v[k], safe=""); sys.stdout.write("postgresql://%s:%s@%s:%s/%s?sslmode=require" % (q("PGUSER"), q("PGPASSWORD"), v["RAILWAY_TCP_PROXY_DOMAIN"], v["RAILWAY_TCP_PROXY_PORT"], q("PGDATABASE")))' | gh secret set PROD_DATABASE_URL
```

```bash
openssl rand -base64 48 | tr -d '\n' | tee >(pbcopy) | gh secret set BACKUP_GPG_PASSPHRASE
```

El segundo comando deja la passphrase en el portapapeles: pégala en tu gestor de contraseñas y
después copia cualquier otra cosa para sacarla del portapapeles.

## Restore

> Restaura primero en **staging** o en una base local. Contra producción, `--clean` borra y vuelve
> a crear los objetos que estén en el dump.

Requisitos: `gh`, `gpg` y el cliente de Postgres 18 (`brew install gnupg postgresql@18`).

1. Descarga el respaldo. Toma el `run-id` de *Actions → db-backup*, o del listado:

   ```bash
   gh run list --workflow db-backup.yml --limit 10
   ```

   ```bash
   gh run download <run-id> --dir restore/
   ```

2. Descifra (pide la passphrase):

   ```bash
   gpg --decrypt -o restore/backup.dump restore/*/crm-diluvium-prod-*.dump.gpg
   ```

3. Revisa el contenido:

   ```bash
   pg_restore --list restore/backup.dump | head -40
   ```

4. Restaura en la base destino (`TARGET_DATABASE_URL`, por ejemplo la URL pública de staging):

   ```bash
   pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error -d "$TARGET_DATABASE_URL" restore/backup.dump
   ```

   `--single-transaction` hace que un error deje la base como estaba, en vez de a medias.

5. Borra los archivos descifrados:

   ```bash
   rm -rf restore/
   ```

Después del restore, las migraciones de Drizzle ya aplicadas quedan registradas en la tabla
`drizzle.__drizzle_migrations` del propio dump. El siguiente deploy solo corre las migraciones que falten.

## Cuándo cambiar a Railway Pro

Cuando entren datos reales de volumen (Fase 2, WhatsApp): PITR da recuperación a cualquier minuto;
este respaldo solo da la foto de hace ≤24 h. Al migrar, borrar el TCP proxy público de la
Postgres si ya nada lo usa (`railway tcp-proxy list --service Postgres`).
