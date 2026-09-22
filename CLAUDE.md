# CRM Diluvium — Especificación de proyecto

> Este archivo va en la raíz del repo. Claude Code y Codex lo leen en cada sesión.
> Si una decisión cambia, se cambia aquí primero y después en el código.

---

## 1. Qué estamos construyendo

Un CRM conversacional propio para Diluvium. El vendedor trabaja **todo el día dentro del CRM
sin abrir WhatsApp Web**. Esa es la prueba de fuego de la v1.

Referencias y qué tomamos de cada una:

| Producto | Qué copiamos | Qué NO copiamos |
|---|---|---|
| Leadsales | El embudo ES la bandeja: tablero kanban donde cada tarjeta es una conversación viva, no un registro muerto | Que un contacto solo pueda estar en un embudo a la vez |
| Respond.io | Hilo único por contacto entre canales, reglas de ruteo/asignación, manejo serio de la ventana de 24 h y plantillas, métricas de tiempo de respuesta | Constructor de flujos visual completo (demasiado para v1) |
| GoHighLevel | Motor de automatizaciones por eventos, calendario, formularios, valor monetario por oportunidad | La bandeja de conversaciones como lista infinita desconectada del pipeline |

**Diferenciador de diseño:** en GHL, "Conversaciones" y "Oportunidades" son dos mundos separados.
En Leadsales están unidos pero un contacto recurrente rompe el modelo. Aquí los unimos bien:
la **oportunidad** es la tarjeta del tablero, la **conversación** es continua por canal, y los
mensajes se atribuyen a la oportunidad abierta en ese momento. Un contacto puede tener historial
infinito y varias oportunidades a lo largo del tiempo sin duplicarse.

---

## 2. Alcance

### v1 (lo único que existe hasta que funcione completo)
1. Auth + organización + roles (owner / admin / agente)
2. Contactos: CRUD, importación CSV, etiquetas, búsqueda, campos personalizados
   flexibles (gestionables desde la UI por admin/owner; arranca vacío)
3. [Fase 2] Canal WhatsApp (Cloud API): recibir, enviar, media, estados de entrega,
   ventana 24 h, plantillas. Requiere aprobación de Meta; no es parte del núcleo v1.
4. Bandeja unificada + vista tablero (embudo kanban) intercambiables
5. Bandeja unificada con soporte para repartir conversaciones entre agentes
   (capacidad presente en el modelo de datos; sin asignación automática ni
   round-robin activos en v1). Ningún contacto tiene dueño fijo: los dos
   agentes ven todos los contactos, siempre.
6. Notas, tareas con recordatorio y línea de tiempo por contacto
7. 4 reportes: conversaciones nuevas, tiempo de primera respuesta, conversión por etapa, ganadas/perdidas
8. Fragmentos (snippets a nivel organización, con variables tipo {{nombre}}):
   respuestas reutilizables. Separados de las plantillas de WhatsApp (Fase 2).

### v2 (no tocar antes de terminar v1)
Automatizaciones visuales, Instagram/Messenger, email, SMS, difusiones masivas, calendario y citas,
formularios y landing pages, agente IA de calificación.

> **Agente IA — Fase A (hecha):** mecanismo de modelo multi-proveedor + selector (`lib/ai/`, tabla
> `ai_config`, pestaña "Agente IA"). Detalle: `docs/agente-ia.md`. **La Fase B (runtime del agente)
> debe PERSISTIR tokens/uso por mensaje procesado** (`callModel` ya devuelve `usage` normalizado) para
> alimentar un panel de gasto futuro.

### Fuera de alcance indefinido
Multi-cliente tipo agencia (snapshots, sub-cuentas), facturación, telefonía/VoIP.

---

## 3. Stack

| Capa | Elección | Razón |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript estricto | Ya se domina del proyecto anterior |
| Base de datos | **PostgreSQL en Railway** (no Turso) | Escrituras concurrentes reales, `LISTEN/NOTIFY` para tiempo real, JSONB para campos personalizados, búsqueda de texto completo en mensajes |
| ORM | Drizzle ORM + drizzle-kit | Migraciones en SQL legible, menos magia que Prisma para que los agentes no improvisen |
| Cola / jobs | BullMQ + Redis (Railway) | Reintentos de envío, recordatorios, automatizaciones diferidas |
| Tiempo real | SSE + Postgres `LISTEN/NOTIFY` en v1 | Suficiente para <50 agentes; migrar a Redis pub/sub al escalar |
| UI | Tailwind + shadcn/ui + dnd-kit | Kanban con arrastre accesible |
| Auth | Better Auth (email + contraseña, sesiones en DB) | Sin dependencia externa de pago |
| Archivos | Railway volume en v1, S3/R2 cuando pese | Media de WhatsApp expira en Meta a los 30 días: hay que descargarla y guardarla |
| Validación | Zod en todo borde de entrada | Webhooks y formularios |

**Por qué no Turso aquí:** el sistema de asistencia es de escritura baja y lectura simple. Un CRM
conversacional tiene webhooks concurrentes, colas, búsqueda y presencia en vivo. Postgres administrado
en Railway se crea con un clic y evita una migración dolorosa en tres meses.

---

## 4. Arquitectura en Railway

Cuatro servicios dentro de un mismo proyecto Railway:

```
railway project: energetic-ambition          # el servicio web se llama "crm-diluvium"
├── web       → Next.js (UI + API routes + webhook receiver)   # servicio "crm-diluvium"
├── worker    → proceso Node con BullMQ (envíos, automatizaciones, recordatorios, descarga de media)
├── postgres  → plugin administrado
└── redis     → plugin administrado
```

Reglas duras:

- El webhook de WhatsApp **solo valida firma, encola y responde 200 en menos de 5 segundos**.
  Todo el procesamiento ocurre en el worker. Si tarda, Meta reintenta y se duplican mensajes.
- Idempotencia obligatoria: `messages.provider_message_id` con índice único. Meta reenvía.
- `web` y `worker` comparten repo y variables de entorno, se despliegan desde la misma rama.
- Entornos (desde el 18-sep-2026): `production` y `staging`, cada uno con su propio web,
  Postgres y Redis (`DATABASE_URL`/`REDIS_URL` son referencias `${{Postgres.…}}`, nunca URLs
  literales). Flujo obligatorio: `feature/*` → rama `staging` (despliega sola en staging) →
  `main` (despliega sola en producción). Ninguna migración, cambio de webhook ni trabajo del
  worker toca `production` sin haberse validado antes en `staging`. Detalle y chequeo de
  aislamiento: `docs/staging.md`.
- Respaldos: `pg_dump` diario cifrado desde GitHub Actions (`.github/workflows/db-backup.yml`),
  con restore de prueba en cada corrida. Secrets en el environment `production-backup`
  (solo `main`), rol `backup_ro` de solo lectura y TLS con CA fijada. Restore: `docs/backups.md`.
  **Sin servicios externos**: el CRM depende solo de GitHub, Railway y Meta.

Variables de entorno mínimas:
```
DATABASE_URL, REDIS_URL, AUTH_SECRET, APP_URL,
ZERNIO_API_KEY, ZERNIO_WEBHOOK_SECRET        (web y worker; canal WhatsApp vía Zernio)
```

---

## 5. Modelo de datos (v1)

Multi-tenant desde el día uno: **toda tabla lleva `organization_id`**. Es barato hoy e imposible después.

**Auth/org (Fase 1, decisión tomada):** en vez de tablas `organizations/users/memberships`
hechas a mano, se usa el schema oficial del plugin `organization` de Better Auth, generado con
`npx @better-auth/cli generate` — resuelve invitaciones, roles personalizables y organización
activa en sesión sin reinventarlos. Equivalencia con este documento:

| Este documento | Tabla real (Better Auth) |
|---|---|
| `organizations` | `organization` |
| `users` | `user` (password hash vive en `account`, provider `credential`) |
| `memberships` (role owner\|admin\|agent) | `member` (roles personalizados vía `createAccessControl`) |
| — (no existía) | `session.activeOrganizationId`, `invitation` |

`memberships.is_active` no existe en el schema de Better Auth. **Decisión (Bloque A, 22-sep-2026):**
"desactivar" un vendedor es `user.banned = true` (campo del plugin **admin** de Better Auth, cuyo
hook bloquea el inicio de sesión) y revocar sus sesiones; **no** se borra su fila de `member` (sus
mensajes conservan el autor y se puede reactivar). El plugin admin se usa SOLO para crear usuarios
desde el servidor y para `banned`: el rol vive **solo** en `member.role` (su `user.role` global no se
usa). Reglas: admin no toca al owner, nadie se desactiva a sí mismo y siempre queda ≥1 owner activo
(también en la BD: triggers diferidos de la migración 0021). En v1 todo miembro (owner/admin/agent)
ve y edita todos los contactos de su organización.

**Roles y permisos de las features conversacionales (v1, 21-sep-2026; ACL en
`lib/auth/permissions.ts` con `createAccessControl`):** el **agente** es el vendedor y hace el
trabajo diario: gestiona **Fragmentos** (crear/editar/borrar; son su herramienta de respuesta
rápida) y en WhatsApp ve, usa y **envía** todo —texto libre y **plantillas** aprobadas—. La
**administración** de plantillas de Meta —darlas de alta o **sincronizarlas**, que tocan la WABA y
su revisión— queda en **owner/admin**. **Enviar** una plantilla aprobada NO pasa por el ACL: es
acción de vendedor, igual que enviar un mensaje. Las plantillas cuyas variables van en el
**encabezado o un botón** no se pueden armar desde el CRM en v1 (solo BODY posicional `{{1}}`): se
marcan `templates.unsupported` al sincronizar y no se ofrecen para enviar.

```
contacts             id, org_id, name, phone_e164 (unique por org), email,
                     custom_fields jsonb, ghl_contact_id (nullable, oculto),
                     source, created_at
tags                 id, org_id, name, color
contact_tags         contact_id, tag_id
snippets             id, org_id, name, body, variables jsonb   -- Fragmentos: {{nombre}} etc.

pipelines            id, org_id, name, is_default
stages               id, pipeline_id, name, position, color, is_won, is_lost
opportunities        id, org_id, contact_id, pipeline_id, stage_id, assignee_user_id,
                     title, value_cents, currency, status(open|won|lost), lost_reason,
                     position numeric, entered_stage_at, created_at, closed_at

channels             id, org_id, type(whatsapp|instagram|email|sms), display_name,
                     credentials jsonb, is_active
conversations        id, org_id, contact_id, channel_id, assignee_user_id,
                     status(open|pending|closed), last_message_at, unread_count,
                     window_expires_at, first_response_seconds
messages             id, org_id, conversation_id, opportunity_id (nullable),
                     direction(in|out), type(text|image|audio|video|document|template),
                     body, media_url, template_name, provider_message_id (unique),
                     status(queued|sent|delivered|read|failed), error_code,
                     sent_by_user_id, created_at
templates            id, org_id, channel_id, name, language, category, body, status, variables jsonb,
                     unsupported (bool)  -- true: variables en encabezado/botón; no enviable desde el CRM en v1

notes                id, org_id, contact_id, user_id, body, created_at
tasks                id, org_id, contact_id, opportunity_id, assignee_user_id,
                     title, due_at, completed_at
activities           id, org_id, contact_id, type, payload jsonb, created_at   -- append-only
audit_log            id, org_id, user_id, action, entity, entity_id, diff jsonb, created_at

-- Bloque A (22-sep-2026). En el CRM no hay "oportunidades" como tabla: la etapa y la
-- calificación viven en el CONTACTO.
contacts (+)         tiene_inundaciones (si|no|no_sabe), nivel_agua_cm, nivel_agua_texto,
                     num_entradas, monto_cotizacion numeric(12,2) MXN, porcentaje_convencimiento (0-100, de 10 en 10)
contact_entradas     id, org_id, contact_id, posicion, ancho_cm, linea (mini|estandar),
                     tamano_sugerido, tamano_manual   -- nunca más filas que num_entradas
tallas_compuerta     id, org_id, linea, talla, min_cm, max_cm, posicion   -- editable owner/admin
contact_comentarios  id, org_id, contact_id, author_user_id (obligatorio), body, created_at, updated_at
                     -- 0022: las notas viejas (custom_fields.notas) se copian aquí con autor de
                     -- sistema "Importado" (sin login ni membresía; solo owner/admin las editan)
scheduled_messages   id, org_id, conversation_id, created_by_user_id, kind (text|template), body,
                     template_id, template_params, send_at, programmed_at, cancel_if_inbound,
                     status (scheduled|sending|sent|failed|cancelled), error_code, message_id
```

Detalles que importan:

- `opportunities.position` es **numérico fraccionario** (índice fraccional). Al arrastrar una tarjeta
  se calcula el punto medio entre sus vecinas. Nunca reordenar la columna entera.
- `conversations.window_expires_at` se actualiza con cada mensaje entrante. La UI **bloquea el
  campo de texto libre** cuando expiró y obliga a elegir plantilla. Esto no es opcional.
- `first_response_seconds` se calcula una sola vez, al primer mensaje saliente humano. Es la métrica
  reina del CRM conversacional.
- `assignee_user_id` en `conversations` y `opportunities` existe para repartir
  carga de chats entre agentes, no para restringir visibilidad. Todos los agentes
  ven todo. En v1 la columna puede quedar en null; no hay round-robin activo.
  `ghl_contact_id` es solo ancla de identidad para re-emparejar al importar/
  re-sincronizar con GHL; no implica propiedad.
- Índices obligatorios: `messages(conversation_id, created_at desc)`,
  `conversations(org_id, last_message_at desc)`, `opportunities(stage_id, position)`,
  `contacts(org_id, phone_e164)`.
- Teléfonos siempre normalizados a E.164 antes de guardar. Una sola función `normalizePhone()`,
  usada en importación, webhook y formularios.

---

## 6. UX de la pantalla principal

**Decisión (18-sep-2026):** ya no es una pantalla con dos modos. Son dos secciones que comparten
el mismo chat. Detalle de la bandeja y contrato de datos para el track UI: `docs/bandeja.md`.

**Sidebar desde el Bloque A (22-sep-2026):** Dashboard (`/inicio`, primero y destino al entrar) ·
Bandeja (`/dashboard`) · Embudo (`/embudo`; antes "Contactos", `/contactos` redirige) · Mensajes
rápidos (`/mensajes-rapidos`; antes "Fragmentos y plantillas", `/snippets` redirige) · Agente IA
(owner/admin) · Configuración (`/configuracion`, al final: Mi cuenta para todos; Vendedores y Tallas
solo owner/admin).

- **Bandeja** (la sección que antes se llamaba "Bandeja / Embudo"; ruta actual `/dashboard`): la
  bandeja de entrada de TODOS los mensajes. Tres columnas: lista de conversaciones, chat y panel
  de contacto. La lista y el panel se abren y cierran con un botón; el chat se queda con el espacio.
- **Embudo** (antes "Contactos"): el tablero kanban (el embudo vive SOLO aquí). Al hacer clic en una
  tarjeta se abre el mismo chat, con el historial completo, la temperatura y la etapa, sin salir del
  tablero.
- **Dashboard**: conversaciones nuevas (contactos creados, sin `ghl_import` ni `seed`) por día local
  de Mazatlán, desgloses por canal/etapa/anuncio y comparación contra el mismo tramo del periodo
  anterior. "Gasto de IA" solo owner/admin (placeholder hasta `ai_usage`).
- **Composer**: "/" busca Fragmentos (`{{vendedor}}` = usuario logueado), ⚡ Fragmentos, 📄
  Plantillas y 🕒 Programar (hora de Mazatlán; fuera de la ventana de 24 h a esa hora, solo
  plantilla; "cancelar si el cliente escribe antes" lo decide el worker al disparar).

```
┌─ Lista (se cierra) ─┬──── Chat ────────────────────────┬─ Contacto (se cierra) ─┐
│ Buscar              │ Nombre · teléfono · etapa         │ Nombre, teléfono       │
│ No leído│Todo│Dest. │ Aviso ventana 24 h                │ Etapa ▾  Temperatura ▾ │
│ fila: avatar,nombre,│ burbujas + adjuntos + estado ✓✓   │ Ver ficha completa     │
│ hora,vista previa,  │ tarjeta "Llegó por anuncio"       │                        │
│ no leídos, semáforo │ composer (bloqueado fuera de 24h) │                        │
└─────────────────────┴───────────────────────────────────┴────────────────────────┘
```

Reglas de UI:
- Al hacer clic en una tarjeta del tablero se abre el chat **sin salir del tablero** (panel lateral).
- Semáforo de tiempo sin respuesta (en la lista de la bandeja y en la tarjeta): verde <15 min,
  ámbar <1 h, rojo >1 h.
- Menos datos es mejor: sin asignación, seguidores, etiquetas ni autor del mensaje en v1.
- Arrastrar una tarjeta entre etapas dispara un evento (`opportunity.stage_changed`) que en v2
  alimentará las automatizaciones. En v1 solo registra actividad.
- Marca: navy `#0A559A` / `#245595`, blanco `#FFFFFF`, naranja `#DE8C11` / `#FE9F29`, tipografía Helvetica.
  Naranja reservado para acciones primarias y alertas, nunca como fondo extenso.

---

## 7. Convenciones de código

- TypeScript `strict: true`. Prohibido `any`.
- Server Actions para mutaciones; API routes solo para webhooks y endpoints públicos.
- Toda consulta a DB filtra por `organization_id`. Helper `withOrg(ctx)` obligatorio, sin excepciones.
- Errores de proveedor nunca se tragan: se guardan en `messages.error_code` y se muestran en la UI.
- Un archivo = una responsabilidad. Componentes de UI sin lógica de datos.
- Migraciones: nunca editar una migración ya aplicada; siempre una nueva.
- Tests: Vitest para lógica pura (normalización de teléfono, parser de webhook, cálculo de posición,
  ventana 24 h). Sin tests de UI en v1.
- `npm test` corre con `--passWithNoTests` **solo temporalmente**, mientras el repo no tiene
  ningún test todavía. Quitar esa bandera de `package.json` en cuanto exista el primer test real
  (el de `normalizePhone()` de la Fase 1) — a partir de ahí el gate debe fallar si no hay tests.

---

## 8. Reparto de trabajo Claude Code ↔ Codex

El plugin de Codex está instalado (`codex@openai-codex`, scope user) y autenticado por
ChatGPT. Codex gasta los límites de la cuenta de ChatGPT, no los de Claude: por eso la
ejecución pesada se delega a Codex y el criterio se queda en Claude. Esta sección es la
regla de reparto; Claude la aplica desde la primera sesión, sin que se le pida cada vez.

### Qué se queda en Claude (la cabeza)
- Entender el problema y preguntar lo que falte antes de tocar nada.
- Planear los pasos, decidir la arquitectura y los límites de cada cambio.
- Features de UI complejas y decisiones que cruzan módulos.
- Revisar todo lo que vuelva de Codex antes de darlo por bueno.

### Qué se le pasa a Codex (las manos)
Claude delega esto **por su cuenta**, con el subagente `codex-rescue`, sin esperar a que
se lo pidan:
- Construcción repetitiva y larga (parser del webhook de Meta, normalización E.164,
  seeds, importador de CSV, migraciones).
- Refactors grandes que tocan muchos archivos.
- Errores atorados que ya se intentaron arreglar una vez.
- Tests.

### Reglas fijas del reparto
1. **Nada de lo que vuelve de Codex se da por bueno sin que Claude lo revise.** En cada
   entrega, Claude dice en dos líneas qué le pidió a Codex y qué volvió.
2. **Si Codex falla dos veces en la misma tarea, la tarea regresa a Claude.** No hay
   tercer intento: cuando algo se atora dos veces, lo que está mal es cómo se pidió, no
   quién lo ejecuta.
3. **Delegar no es desentenderse.** Si no se sabe qué se movió, no se está repartiendo.
4. Antes de cada merge a `main`: `/codex:adversarial-review` sobre el diff.

### Comandos de verificación (sandbox de revisión)

La revisión de Codex corre con `sandbox: read-only` y `approvalPolicy: never`:
un muro técnico **sin red y sin escrituras**, donde el agente **no puede
aprobar prompts**. Por eso las verificaciones se ejecutan con **scripts de npm**
(resuelven el binario local) y **nunca con `npx`** —que iría al registry o
pediría confirmación y colgaría la corrida—, siempre con **timeout** (120 s):

- `npm run typecheck` → `tsc --noEmit --incremental false` (sin `tsconfig.tsbuildinfo`; escribirlo daría `EPERM/TS5033` bajo read-only)
- `npm test` → `vitest run`
- `npm run lint` → `eslint`

Regla para Codex y Claude: cualquier check nuevo se agrega como script de
`package.json`, no como comando suelto con `npx`. Detalle idéntico en `AGENTS.md`.

### Higiene de trabajo en paralelo
- **Nunca dos agentes sobre los mismos archivos.** Usar git worktrees:
  ```
  git worktree add ../crm-inbox    feature/inbox
  git worktree add ../crm-contacts feature/contacts
  ```
- Trabajar en **rebanadas verticales** (schema → API → UI de una sola feature), nunca por capas.
  Una rebanada terminada es una que se puede desplegar y usar.

---

## 9. Fases y criterio de terminado

| Fase | Entregable | Terminado cuando |
|---|---|---|
| 0 | Repo + Railway + deploy vacío + trámite Meta iniciado | La URL de Railway responde y el número está en revisión |
| 1 | Auth + org + contactos | Se importa un CSV de 500 contactos y se buscan por nombre/teléfono |
| 2 | Canal WhatsApp | Un mensaje real entra, se ve en la bandeja, se responde y llega al celular |
| 3 | Embudo kanban | Se arrastra una tarjeta entre etapas y persiste tras recargar |
| 4 | Notas, tareas, timeline | El historial completo de un contacto se ve en una sola vista |
| 5 | Reportes | Las 4 métricas cuadran contra consulta SQL manual |

Regla: **no se empieza una fase sin que la anterior esté desplegada en Railway y usada por una persona real.**

---

## 10. Riesgos conocidos

1. **WhatsApp Cloud API es el camino crítico.** Requiere Meta Business verificado, número dedicado
   (no puede estar activo en la app de WhatsApp), y plantillas aprobadas una por una. El trámite
   puede tardar días o semanas. Se inicia antes que el código.
2. **Ventana de 24 h.** Si se ignora, el CRM parecerá roto para el vendedor. Va modelada desde la fase 2.
3. **Duplicación de mensajes** por reintentos de Meta. Se resuelve solo con el índice único en
   `provider_message_id`.
4. **Multi-tenant tardío.** Agregar `organization_id` después obliga a reescribir todas las consultas.
5. **Alcance.** Cada módulo de GHL que se agregue antes de terminar la v1 retrasa el día en que
   el equipo empieza a usar el CRM de verdad.
6. **Deudas P0 — cerradas el 18-sep-2026 (PRs #2, #3, #4):**
   (a) rate limiter por IP en `/api/auth/*` (`lib/rate-limit`, Redis, ventana deslizante
   atómica; 20/15 min en sign-in, 120/min general). IP = primer valor de `x-forwarded-for`
   (el edge de Railway descarta el del cliente; verificado en staging con XFF falsificado).
   El limiter de fábrica de Better Auth queda apagado, y el candado por email sigue igual.
   (b) staging creado y aislado. (c) respaldos diarios con restore de prueba en cada corrida.
   Riesgo aceptado: si el repo pasa más de 60 días sin actividad, GitHub apaga el cron sin
   avisar. (d) **Decisión (18-sep): WhatsApp por Zernio con coexistencia**, no por la Cloud API
   directa. Coexistencia (el número sigue en la app de WhatsApp Business del celular y además en
   el CRM) solo la puede activar un Tech Provider; hacerse uno toma semanas, y Zernio ya lo es.
   Los vendedores conservan la app, y desde ella mandan los .XML de facturación, que la API no
   acepta como documento. La WABA sigue siendo de Diluvium (portafolio "Grupo Diluvium"). El
   backend usa una interfaz de proveedor (`lib/messaging/provider.ts`) para poder migrar a la
   API directa después. Desde el 1-oct-2026 Meta cobra también los mensajes dentro de la
   ventana de 24 h.
   Ensayo de restore completo en staging (18-sep): se descargó un artifact real de `main`, se
   descifró con la passphrase guardada, se restauró en una base limpia (60 contactos, 10 tablas),
   se hizo el intercambio atómico, se inició sesión con el usuario de producción y se cargó
   /contactos. También se probó el rollback. Procedimiento: `docs/backups.md`.
