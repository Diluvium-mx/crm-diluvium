# Migrar a otra Mac

> Qué hay que llevar, qué se instala de nuevo y cómo comprobar que quedó igual.
> El CRM en vivo **no depende de ninguna Mac**: vive en Railway (web, worker, base de datos, Redis,
> archivos y secretos) y el código y los documentos en GitHub. En la Mac solo hay copias de trabajo.

## 1. La carpeta única

Todo lo del CRM en la Mac vive en `~/Documents/Diluvium CRM/` (el nombre lleva espacio: en la terminal,
siempre entre comillas, p. ej. `cd "$HOME/Documents/Diluvium CRM"`):

```
~/Documents/Diluvium CRM/
  crm-diluvium/   copia principal del repo (todos los .md del CRM viven en su raíz y en docs/)
  chats/          una carpeta por chat de Code (git worktrees)
  media/          videos, fotos y PDF originales de los workflows; media/listos/ = versiones para WhatsApp
  notas/          archivos del CRM que no van en el repo (exportaciones de GHL, respaldos del Goal)
  LEEME.md        qué hay en cada carpeta y dónde vive cada cosa
```

Los worktrees nuevos se crean en `chats/` (ver `CLAUDE.md` §8).

## 2. Qué instalar

`scripts/setup-mac.sh` hace todo esto solo (se puede correr varias veces sin romper nada):

| Herramienta | Para qué | Cómo |
|---|---|---|
| Xcode Command Line Tools | `git` | `xcode-select --install` |
| Homebrew | instalar lo demás | https://brew.sh |
| Node.js (≥ 22.12) | correr el CRM y los tests | `brew install node` |
| GitHub CLI (`gh`) | clonar, subir y crear PRs | `brew install gh` |
| Railway CLI | ver variables, logs y la base de producción/staging | `npm install -g @railway/cli` |
| PostgreSQL 18 | base local para tests de integración | `brew install postgresql@18` y `brew services start postgresql@18` |
| ffmpeg y jq | convertir videos para WhatsApp; leer JSON | `brew install ffmpeg jq` |
| Codex CLI | revisiones de Codex desde Claude Code | `npm install -g @openai/codex` |
| App de Claude (escritorio) | Claude Code | https://claude.ai/download |

Docker y Redis **no** hacen falta: los tests que usan Redis se saltan solos si no hay `REDIS_TEST_URL`.

## 3. Inicios de sesión (los hace el usuario a mano)

Nadie más que el usuario escribe contraseñas. Cada uno abre el navegador:

1. **GitHub:** `gh auth login` → GitHub.com → HTTPS → "Login with a web browser". Esto crea una
   **llave nueva** para esta Mac (se guarda en el llavero de macOS). **No copies** la llave vieja
   (`.git/.push-credentials` de la Mac anterior es un token en texto plano): cuando la Mac vieja se
   retire, revócalo en GitHub → Settings → Developer settings → Personal access tokens, y en
   Settings → Applications quita la sesión de GitHub CLI de la Mac vieja.
2. **Railway:** `railway login`. Luego, dentro de `~/Documents/Diluvium CRM/crm-diluvium`:
   `railway link` → proyecto `energetic-ambition` → entorno `production` → servicio `crm-diluvium`.
3. **Claude:** abrir la app de Claude e iniciar sesión. En Claude Code: `/plugin install codex@openai-codex`
   y luego `/codex:setup`.
4. **ChatGPT para Codex:** `codex login` (usa la cuenta de ChatGPT; Codex gasta sus límites, no los de Claude).

## 4. Qué copiar de la Mac vieja

Solo esto (todo lo demás se clona o se instala):

| Qué | De dónde | A dónde |
|---|---|---|
| Medios | `~/Documents/Diluvium CRM/media/` | igual |
| Notas | `~/Documents/Diluvium CRM/notas/` y `LEEME.md` | igual |
| Memoria de Claude del proyecto | `~/.claude/projects/-Users-<usuario>-Documents-crm-diluvium/memory/` | `~/.claude/projects/<ruta nueva>/memory/` (ver abajo) |
| Skill cyber-neo | `~/.claude/skills/cyber-neo/` | igual |

**Memoria de Claude:** Claude guarda la memoria en una carpeta cuyo nombre es la ruta del proyecto con
todo lo que no es letra o número cambiado por `-` (las `/` y el espacio). Con el repo en
`~/Documents/Diluvium CRM/crm-diluvium`, la carpeta es
`~/.claude/projects/-Users-<usuario>-Documents-Diluvium-CRM-crm-diluvium/memory/`. Copia ahí el contenido de
la vieja (`-Users-<usuario>-Documents-crm-diluvium`); si no, Claude arranca sin memoria del proyecto.

**No se copian:** `.env.local` (se crea de nuevo desde `.env.example` con valores locales; los secretos
de producción viven en Railway), `.git/.push-credentials`, `node_modules/`, `.next/`, sesiones de
`gh`/`railway`/`codex` (se vuelven a iniciar) y las bases locales de prueba (se recrean vacías).

Para copiar: AirDrop o un disco externo con las carpetas `media/` y `notas/`, o
`rsync -a --progress "<mac-vieja>:Documents/Diluvium CRM/"{media,notas,LEEME.md} "$HOME/Documents/Diluvium CRM/"`.

## 5. Pasos en orden

1. Instalar la app de Claude e iniciar sesión.
2. `xcode-select --install` (si no está) e instalar Homebrew.
3. `gh auth login` (paso 3.1).
4. Clonar solo el script y correrlo:
   ```bash
   gh api repos/Diluvium-mx/crm-diluvium/contents/scripts/setup-mac.sh -H "Accept: application/vnd.github.raw" > /tmp/setup-mac.sh && bash /tmp/setup-mac.sh
   ```
5. `railway login` y `railway link` (paso 3.2); `codex login`; plugin de Codex en Claude Code.
6. Copiar `media/`, `notas/`, la memoria y cyber-neo (sección 4).
7. Llenar `.env.local` con valores **locales** (base `postgres://<usuario>@localhost:5432/<base>`).
8. Correr la lista de verificación.

## 6. Lista de verificación

Todo debe salir igual que en la Mac vieja:

- [ ] `gh auth status` → sesión en `Diluvium-mx` con scopes `repo` y `workflow`.
- [ ] `railway whoami` y `railway status` → proyecto `energetic-ambition`, entorno `production`.
- [ ] `cd "$HOME/Documents/Diluvium CRM/crm-diluvium" && git status` → limpio, en `main` al día con `origin/main`.
- [ ] `npm run typecheck`, `npm test` y `npm run lint` en verde (mismo número de tests que en la Mac vieja).
- [ ] `psql -h localhost -d postgres -c 'select 1'` responde.
- [ ] En Claude Code, `/codex:setup` dice que Codex está listo.
- [ ] Al abrir un chat nuevo en el repo, Claude muestra la memoria del proyecto (MEMORY.md).
- [ ] `ls ~/.claude/skills/cyber-neo` existe.
- [ ] `du -sh "$HOME/Documents/Diluvium CRM/media" "$HOME/Documents/Diluvium CRM/notas"` da lo mismo que en la Mac vieja
      (y `find media -type f | wc -l` el mismo número de archivos).
- [ ] La URL de producción abre y se puede iniciar sesión (eso no depende de la Mac; si falla, es de Railway).
