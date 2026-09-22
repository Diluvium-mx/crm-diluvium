<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Comandos de verificación (Codex y Claude)

Corre las verificaciones con los **scripts de npm**, que resuelven los binarios
desde `./node_modules/.bin`. **Nunca uses `npx`** para estas tareas: cuando el
binario no está en las dependencias locales, `npx` lo descarga del registry de
npm y además imprime un prompt de confirmación de instalación
(<https://docs.npmjs.com/cli/v11/commands/npx>). Dentro del sandbox **read-only**
de la revisión —sin red y sin TTY— eso se queda esperando la descarga o la
respuesta al prompt y **cuelga la sesión**.

- Typecheck: `npm run typecheck`  (= `tsc --noEmit --incremental false`)
- Tests:     `npm test`           (= `vitest run`)
- Lint:      `npm run lint`        (= `eslint`)

Ejecuta cada comando con un **timeout** (p. ej. 120 s). El sandbox read-only es
un muro técnico que **deniega escrituras**: por eso el typecheck lleva
`--incremental false`, para no escribir `tsconfig.tsbuildinfo` (que sin esa
bandera provoca `EPERM` / `TS5033` bajo el sandbox).
