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
railway project: crm-diluvium
├── web       → Next.js (UI + API routes + webhook receiver)
├── worker    → proceso Node con BullMQ (envíos, automatizaciones, recordatorios, descarga de media)
├── postgres  → plugin administrado
└── redis     → plugin administrado
```

Reglas duras:

- El webhook de WhatsApp **solo valida firma, encola y responde 200 en menos de 5 segundos**.
  Todo el procesamiento ocurre en el worker. Si tarda, Meta reintenta y se duplican mensajes.
- Idempotencia obligatoria: `messages.provider_message_id` con índice único. Meta reenvía.
- `web` y `worker` comparten repo y variables de entorno, se despliegan desde la misma rama.
- Entornos: en la Fase 1 solo existe `production` como environment de Railway — sin datos
  reales todavía, así que validar ahí directamente no arriesga nada. **Antes de iniciar la
  Fase 2** (entran contactos reales y el canal de WhatsApp) se crea obligatoriamente un
  environment `staging` con su propio Postgres. A partir de ese punto, ninguna migración,
  cambio de webhook ni trabajo del worker toca `production` sin haberse validado antes en
  `staging`. Antes de importar cualquier dato real también quedan definidos los
  procedimientos de respaldo y restauración (backup/restore) de la base de datos.

Variables de entorno mínimas:
```
DATABASE_URL, REDIS_URL, AUTH_SECRET, APP_URL,
WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID,
WHATSAPP_ACCESS_TOKEN, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
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

`memberships.is_active` no existe en el schema de Better Auth: en v1 "desactivar" un miembro es
borrar su fila de `member`, no un booleano. En v1 todo miembro (owner/admin/agent) ve y edita
todos los contactos de su organización.

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
templates            id, org_id, channel_id, name, language, category, body, status, variables jsonb

notes                id, org_id, contact_id, user_id, body, created_at
tasks                id, org_id, contact_id, opportunity_id, assignee_user_id,
                     title, due_at, completed_at
activities           id, org_id, contact_id, type, payload jsonb, created_at   -- append-only
audit_log            id, org_id, user_id, action, entity, entity_id, diff jsonb, created_at
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

Una sola pantalla con dos modos que comparten el mismo panel derecho:

```
┌─────────────┬──────────────────────────┬────────────────┐
│ Embudos     │  Chat de la conversación │ Ficha contacto │
│ Filtros     │  (hilo único, multicanal)│ Campos, etapa, │
│ Mis chats   │  Composer + plantillas   │ valor, tareas, │
│ Sin asignar │  Aviso ventana 24 h      │ notas, timeline│
└─────────────┴──────────────────────────┴────────────────┘
        ⇅ toggle
┌───────────────────────────────────────────────────────────┐
│  TABLERO: columnas = etapas, tarjetas = conversación viva │
│  Cada tarjeta: avatar, nombre, último mensaje, tiempo sin │
│  respuesta (color), responsable, valor, badge no leídos   │
└───────────────────────────────────────────────────────────┘
```

Reglas de UI:
- Al hacer clic en una tarjeta del tablero se abre el chat **sin salir del tablero** (panel lateral).
- Semáforo de tiempo sin respuesta en la tarjeta: verde <15 min, ámbar <1 h, rojo >1 h.
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
6. **Deudas P0 antes de exponer datos reales (entran al cerrar Fase 1, antes de Fase 2):**
   (a) rate limiter por IP en `/sign-in/email` con `trustedProxies` verificado contra
   headers reales de Railway (`x-real-ip` roto tras Fastly; usar `x-forwarded-for`),
   con tests de concurrencia y carga — en Fase 1 solo queda el candado por email
   (5 fallos/300 s, Postgres, reserva atómica); (b) staging obligatorio antes de
   Fase 2; (c) respaldos de BD definidos antes de importar datos reales;
   (d) evaluar Zernio como capa de API oficial de WhatsApp (precio para el volumen,
   si Coexistence cubre envío de .XML). Principio: no sobre-blindar Fase 1 con datos
   falsos y 2 usuarios.
