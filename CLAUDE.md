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
8. Mensajes rápidos (antes "Fragmentos"; tabla `snippets` a nivel organización, con variables tipo
   {{nombre}}): respuestas reutilizables. Separados de las plantillas de WhatsApp (Fase 2).
9. **Canal Instagram (DMs) — entra a v1 (decisión del dueño, 2-oct-2026).** Por Zernio, igual que
   WhatsApp (sin proveedor nuevo; Instagram Login con solo el permiso de mensajes). GHL ya se
   desconectó de Instagram y Facebook ese día. Reglas del dueño: el cliente de Instagram es un
   **contacto aparte** (se identifica por su id de Instagram y su @usuario, sin teléfono) y **no hay
   botón para unirlo** con uno de WhatsApp: son clientes distintos. El **Agente IA contesta** en
   Instagram desde que el canal se conecta. Reglas de Meta: ventana de 24 h; de 24 h a 7 días solo
   un vendedor puede contestar (etiqueta `HUMAN_AGENT`; ni el Agente IA ni las automatizaciones);
   después, nada hasta que el cliente escriba; no hay plantillas ni se puede escribir primero.
   Detalle: `docs/instagram.md`. TikTok queda para después.

### v2 (no tocar antes de terminar v1)
Automatizaciones visuales, Messenger, email, SMS, difusiones masivas, calendario y citas,
formularios y landing pages, agente IA de calificación, TikTok.

> **Agente IA — Fase A (hecha):** mecanismo de modelo multi-proveedor + selector (`lib/ai/`, tabla
> `ai_config`, pestaña "Agente IA"). Detalle: `docs/agente-ia.md`. **Fase D (24-sep-2026):** la pestaña
> Automatización solo tiene envíos de media (texto, archivo con pie, espera) con disparadores agente /
> comando / palabra clave / etapa; etapa, avisos al vendedor y comprobantes son **acciones internas del
> agente** (`mover_etapa` solo hacia adelante, `aviso_vendedor`, `fijar_cotizacion`) decididas por el
> Goal, no por código. Diseño: `docs/fase-d-diseno.md` §10. **Fase D CERRADA el 25-sep-2026** (main
> 057725c, migración 0031; prueba B5 en producción y pendientes A–F sin construir: §11 del mismo doc).
> **Fase E CERRADA el 26-sep-2026 (main ebcd981).** Modelo 1 (Luna) y Modelo 2 (Sonnet 5) por etapa, con
> sus selectores en la pestaña Agente IA, más el reenvío seguro; 5 proveedores activos (OpenAI, Anthropic,
> Gemini, Grok, Qwen). Recargas de saldo: manuales en la página de cada proveedor. **Respuesta sin completar (5-oct-2026, dueño):** texto interno del modelo (`[tool call] …`, notas), corte por tokens, una acción que no se puede hacer o algo que no salió después de enviar → no sale nada más al cliente, tarjeta `agente_error` y el Agente IA en pausa en ese chat hasta Reintentar/Apagar (`lib/ai/runtime/internal-text.ts`, `holdAgentForReview`; detalle en `docs/agente-ia.md`). Revisión de Codex:
> penúltima acción antes del número oficial. **Agente IA parte 1 (26-sep-2026, migración 0037):** acción
> `actualizar_detalle` en la misma respuesta (llena y corrige el Detalle del contacto; ningún dato es
> definitivo, ni del vendedor ni del agente; `custom_fields.detalle_por` = quién escribió al último → marca
> "IA"; % de convencimiento solo del agente; "Pausar agente"/"Activar" solo en el Detalle), notas de voz
> transcritas con `gpt-4o-mini-transcribe` (el agente las lee; "Transcripción" en el chat), un error de
> envío deja la respuesta guardada y "Reintentar" manda el MISMO texto (nunca otra llamada al modelo), y
> `ai_config.daily_budget_usd` borrada. Detalle: `docs/agente-ia.md` › Parte 1. **Caché de 1 h (2-oct-2026):** las marcas de caché de
> Anthropic usan `ttl: "1h"` y el worker la renueva de 7:00 a 22:00 (Mazatlán) con una lectura mínima
> (`lib/ai/runtime/cache-keepalive.ts`, `ai_usage.outcome = 'cache_renovada'`); la escritura de 1 h se cobra a 2×
> la entrada. Detalle: `docs/agente-ia.md` › Caché de 1 hora. Fase E, parte 1: selectores, etapas (Modelo 1 = Inbox, Prospecto,
> Interesado), adaptadores de Google/xAI/OpenRouter y tope de 4,096 tokens (migración 0033). Parte 2
> (migración 0034): **reenvío seguro** = si el modelo falla, tarjeta en el chat con el error explicado y
> botones "Reintentar" / "Apagar" (pausa esa conversación); sin reintentos automáticos salvo UNO si el
> proveedor está saturado. Aviso de pago = "Depósito recibido" fijo; el agente ya no anota monto ni
> folio y no hay chequeo de folio repetido (decisión del dueño). Detalle: `docs/agente-ia.md`. **La Fase B (runtime del agente)
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
META_ADS_ACCESS_TOKEN                        (web; el worker la referencia; solo ads_read — docs/anuncios.md)
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
rápida) y en WhatsApp ve, usa y **envía** todo —texto libre y **plantillas** aprobadas—. Desde el
26-sep-2026 también **administra** las plantillas de Meta (darlas de alta y **sincronizarlas**),
como owner/admin (ver la tabla de roles). **Enviar** una plantilla aprobada NO pasa por el ACL: es
acción de vendedor, igual que enviar un mensaje. Las plantillas cuyas variables van en el
**encabezado o un botón** no se pueden armar desde el CRM en v1 (solo BODY posicional `{{1}}`): se
marcan `templates.unsupported` al sincronizar y no se ofrecen para enviar.

**Roles (26-sep-2026, decisión del dueño; amplía la del 25-sep. ACL en `lib/auth/permissions.ts`, las
páginas y Server Actions repiten la regla; `lib/auth/permissions.test.ts` exige que admin/owner tengan TODO
lo del vendedor y que al vendedor solo le falte Configuración):**

| Rol | Qué puede |
|---|---|
| Owner | Dueño de la cuenta: todo, incluido administrar a los admins (solo él asigna el rol owner). |
| Admin | Todo lo del vendedor + Configuración (Vendedores). |
| Vendedor (`agent`) | Todas las herramientas del CRM menos la pestaña Configuración: Dashboard (incluido registrar recargas de IA), Bandeja, Embudo, Mensajes rápidos (fragmentos y crear/sincronizar plantillas de Meta), contactos en masa (importar/exportar/borrar), editar/borrar comentarios de otros, Anuncios, Agente IA (incluida la sección "Tallas y medidas", desde el 26-sep-2026) y Automatización. |

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
                     window_expires_at, first_response_seconds,
                     attended_at  -- 0045: «Marcar como leído» apaga el azul del Embudo sin contestar
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
tallas_compuerta     id, org_id, linea, talla, min_cm, max_cm, posicion   -- editable por todos (Agente IA › Tallas y medidas)
                     -- 5-oct-2026: también llega al Agente IA como sección TAMAÑOS del system (lib/ai/runtime/brain-system.ts)
contact_comentarios  id, org_id, contact_id, author_user_id (obligatorio), body, created_at, updated_at
                     -- 0022: las notas viejas (custom_fields.notas) se copian aquí con autor de
                     -- sistema "Importado" (sin login ni membresía; las edita cualquier rol, 26-sep)
comprobantes         id, org_id, contact_id, conversation_id, message_id (único), monto, referencia,
                     referencia_norm, banco, fecha_comprobante, tipo (total|anticipo|resto), created_at
                     -- Fase D (0031). SIN USO desde la Fase E (25-sep): el agente ya no anota monto ni
                     -- folio; la tabla se conserva con su historial (no se borra)
ai_agent_notices (+) resolved_at, resolution (reintentar|apagar), resolved_by_user_id   -- 0034, tarjeta agente_error
contacts (+)         pago_total numeric(12,2) MXN  -- 0047: lo que el cliente ya pagó. monto_cotizacion = total de lo
                     que el CLIENTE eligió al final (regla del dueño, 28-sep-2026), no lo primero que se cotizó
conversations (+)    detalle_leido_hasta  -- 0047: el Agente IA lee en SEGUNDO PLANO (lib/ai/runtime/lector.ts)
                     y deja al día etapa y Detalle aunque esté apagado o pausado; nunca le escribe al cliente
contacts (+)         stage_changed_by (vendedor|agente|sistema): la etapa de un vendedor manda; el agente solo avanza
                     custom_fields.detalle_por { campo: agente|vendedor }  -- parte 1: el agente solo llena lo vacío o lo suyo
contacts (+)         destacado bool -- 0048 (29-sep-2026): Destacado ⭐ del contacto, aparte de la temperatura y
                     combinable (🔥 + ⭐). Es la estrella de la Bandeja y el ⭐ del Embudo. `conversations.is_starred` y
                     el valor 'destacado' de contact_temperature quedan sin uso.
messages (+)         transcripcion text   -- 0037: nota de voz del cliente (estado en metadata.transcripcion)
contacts (+)         instagram_id (IGSID, único por org), instagram_username  -- 0055: cliente de Instagram, sin
                     teléfono (docs/instagram.md); channels.type acepta 'instagram'
messages (+)         metadata.partesInstagram (ids de las otras partes de UN envío), metadata.avisoEnvio
                     (salió incompleto)
ai_agent_drafts (+)  runs jsonb; status "pendiente" = respuesta guardada cuyo envío falló ("Reintentar" la reenvía igual)
                     -- autor de sistema de comentarios "Agente IA" (usuario-sistema-agente-ia, 0037), como "Importado"
scheduled_messages   id, org_id, conversation_id, created_by_user_id, kind (text|template), body,
                     template_id, template_params, send_at, programmed_at, cancel_if_inbound,
                     status (scheduled|sending|sent|failed|cancelled), error_code, message_id

-- Columnas del Embudo (27-sep-2026, migración 0041; detalle en docs/agente-ia.md). Las etapas ya NO son
-- el enum contact_stage: son filas por organización. contacts.stage y workflows.trigger_stage guardan
-- la CLAVE con llave foránea compuesta (organization_id, key): ningún contacto apunta a una etapa que no existe.
funnel_stages        id, org_id, key (estable, a-z0-9_), name, position, color (sin uso), role (entrada|cerca_compra|
                     venta_cerrada, cada uno en UNA etapa; entrada primero y cerca_compra antes que venta_cerrada),
                     bot_rule (cuándo mueve el agente ahí), model_slot (1|2; sustituye a ai_config.etapas_modelo_1)
                     -- 2-oct-2026 (dueño): a venta_cerrada (anticipo o total) el Agente IA solo pasa si un VENDEDOR
                     -- contestó DESPUÉS del último comprobante del cliente (lib/ai/runtime/venta-cerrada.ts); si no, cerca_compra

-- Anuncios de Meta (24/25-sep-2026, migraciones 0035 + 0036; la 0030 quedó vacía; detalle en docs/anuncios.md)
ad_clicks            id, org_id, contact_id, conversation_id, message_id, origin (webhook|zernio_conversation),
                     ad_id, ctwa_clid, headline…, raw jsonb (ficha original completa), clicked_at
                     -- una fila por entrada desde un anuncio; la atribución vive aquí (contacto + conversación)
meta_ads             org_id + ad_id, campaña/conjunto/anuncio, creativo (título, texto, CTA, enlace), datos del
                     video (sin archivo), enlaces a Meta, meta_raw, UNA miniatura chica (thumbnail_key) y
                     effective_status + status_checked_at (estado leído de Meta cada hora; viejo → "—")
conversations (+)    ad_entry_at   -- última entrada por anuncio (ventana gratis de 72 h)

-- Seguimientos del Agente IA (2-oct-2026, migración 0056; diseño en docs/seguimientos.md). Parte 1 = MODO ENSAYO:
-- se calcula todo y se ve en la píldora 🤖, pero NO se le manda nada al cliente (follow_ups.ensayo).
follow_ups           id, org_id, conversation_id, contact_id, caso (tabla de 10 casos, lib/followups/cases.ts),
                     status (programado|esperando|contestado|cancelado|terminado|no_seguir), ensayo, intento/total_intentos,
                     ficha del lector (pendiente, siguiente_paso, borrador, fecha_pedida…), time_zone (por lada), due_at,
                     door (texto|plantilla), template_name, modo (automatico|sugerido), intentos jsonb, based_on_message_at
                     -- la ficha sale en la MISMA lectura del lector (sin llamada extra); un solo programado/esperando por chat
                     -- 0057 (3-oct): caso_de_fondo (asunto de una fecha pedida: da la hora), plantilla_2/_3 (las elige el lector
                     -- según cómo quedó el chat). El seguimiento de un VENDEDOR cuenta como intento; Compra cancela al instante;
                     -- el CRM revisa el borrador (una pregunta, nunca una ya hecha ni el precio ya dado) y el lector lo rehace 1 vez
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
rápidos (`/mensajes-rapidos`, pestañas "⚡ Mensajes rápidos · 📄 Plantillas"; antes "Fragmentos y plantillas",
`/snippets` redirige) · Anuncios (`/anuncios`,
tabla de anuncios de Meta que trajeron clientes en el periodo) · Agente IA · Automatización ·
Configuración (`/configuracion`, al final, solo owner/admin: Vendedores; "Tallas" pasó a Agente IA › "Tallas y
medidas" el 26-sep-2026, editable por todos los roles). Abajo del sidebar,
el menú del usuario (todos): "Mi cuenta" (`/mi-cuenta`: nombre y cambiar la propia contraseña) y
"Cerrar sesión".

- **Bandeja** (la sección que antes se llamaba "Bandeja / Embudo"; ruta actual `/dashboard`): la
  bandeja de entrada de TODOS los mensajes. Tres columnas: lista de conversaciones, chat y panel
  de contacto. La lista y el panel se abren y cierran con un botón; el chat se queda con el espacio.
- **Embudo** (antes "Contactos"): el tablero kanban (el embudo vive SOLO aquí). Al hacer clic en una
  tarjeta se abre el mismo chat, con el historial completo, la temperatura y la etapa, sin salir del
  tablero (abrirlo marca leído, como en la Bandeja). Tarjeta (25-sep): fondo amarillo si el Agente IA
  pasó al cliente a un asesor o necesita al vendedor (aviso abierto sin respuesta humana posterior),
  azul si el último mensaje es del cliente (gana el amarillo), círculo naranja con los no vistos; en
  vivo por el SSE (`lib/contacts/funnel-signals.ts`). Sin bandera junto al número: solo ciudad por lada.
- **Dashboard**: HASTA ARRIBA el "Gasto de IA" (todos lo ven; registrar recargas, owner/admin; decisión del dueño 25-sep: el saldo
  importa más que las métricas): total del mes y, por cada proveedor con llave, gasto del mes y saldo
  estimado en cifras grandes. Debajo, conversaciones nuevas (contactos creados, sin `ghl_import` ni
  `seed`) por día local de Mazatlán, desgloses por canal/etapa/anuncio y comparación contra el mismo
  tramo del periodo anterior.
- **Composer**: "/" busca mensajes rápidos (sin importar acentos ni mayúsculas; `{{vendedor}}` = usuario
  logueado), ⚡ Mensajes rápidos, 📄 Plantillas y 🕒 Programar (hora de Mazatlán; fuera de la ventana de 24 h a esa hora, solo
  plantilla; "cancelar si el cliente escribe antes" lo decide el worker al disparar).
- **Cambios en vivo** (26-sep-2026): etapa, temperatura, cotización y Detalle cambiados por el Agente IA,
  una automatización u otro vendedor se ven sin refrescar (evento `contact.updated`, un solo helper
  `lib/contacts/notify-updated.ts` dentro de la transacción de cada escritura). Aviso emergente solo
  para cambios de ETAPA hechos por otro. Detalle: `docs/bandeja.md` › "Cambios en vivo".
- **Opciones del bot** (26-sep-2026, migración 0038): sección "Opciones" en la pestaña Agente IA, para
  todos los roles, con las opciones de Ángela (espera 5–60 s, pausa por vendedor y reactivar tras N h,
  pedir asesor que avisa o pausa X h, horario de Mazatlán con apertura escalonada, imágenes y notas de
  voz, longitud, 1 o 2 mensajes, tope de respuestas con aviso amarillo). **Fábrica = comportamiento
  anterior.** El worker las relee con caché de 60 s; `ai_config_changes` guarda quién cambió qué.
  Detalle: `docs/agente-ia.md` → "Opciones del bot".
- **Pausar agente** (25-sep-2026; "Apagar bot" hasta el 26-sep): por conversación, 8/12/24 h, hora exacta (Mazatlán, ≤30 días) o indefinidamente; "Activar" lo regresa; vuelve solo con el barrido del worker y no contesta lo escrito mientras estuvo pausado. Desde el 26-sep el control vive solo en "Detalle del contacto". Detalle: `docs/bandeja.md`.

```
┌─ Lista (se cierra) ─┬──── Chat ────────────────────────┬─ Contacto (se cierra) ─┐
│ Buscar        [⊽🔥] │ Nombre · teléfono · etapa         │ Nombre, teléfono       │
│ No leído│Todo│Dest. │ Aviso ventana 24 h                │ Etapa ▾  Temperatura ▾ │
│ fila: avatar,nombre,│ burbujas + adjuntos + estado ✓✓   │ Ver ficha completa     │
│ hora,vista previa,  │ tarjeta "Llegó por anuncio"       │                        │
│ no leídos, semáforo │ composer (bloqueado fuera de 24h) │                        │
└─────────────────────┴───────────────────────────────────┴────────────────────────┘
```

Reglas de UI:
- Al hacer clic en una tarjeta del tablero se abre el chat **sin salir del tablero** (panel lateral).
- **Colores de la tarjeta del Embudo (28-sep-2026):** azul = el cliente escribió y nadie le ha
  contestado (se apaga con una respuesta que salió o con «Marcar como leído»; abrir el chat no);
  amarillo (gana) = el Agente IA necesita al vendedor (se apaga contestando); círculo naranja = sin
  ver. La luz del cursor en la tarjeta es gris. Cada columna va por actividad: arriba el último que
  escribió o entró a la etapa, en vivo. Detalle: `docs/bandeja.md` › Colores y orden del Embudo.
- **No leído por columna del Embudo (30-sep-2026):** sobre en una píldora junto al contador de cada
  columna (mismo alto, sin texto). Prendido (naranja) deja solo las tarjetas con círculo naranja, azul
  o amarilla (`needsAttention`); cada columna por su lado; no se recuerda al recargar.
- Semáforo de tiempo sin respuesta (en la lista de la bandeja y en la tarjeta): verde <15 min,
  ámbar <1 h, rojo >1 h.
- Menos datos es mejor: sin asignación, seguidores, etiquetas ni autor del mensaje en v1.
- Arrastrar una tarjeta entre etapas dispara un evento (`opportunity.stage_changed`) que en v2
  alimentará las automatizaciones. En v1 solo registra actividad.
- Marca: navy `#0A559A` / `#245595`, blanco `#FFFFFF`, naranja `#DE8C11` / `#FE9F29`, tipografía Helvetica.
  Naranja reservado para acciones primarias y alertas, nunca como fondo extenso.
- **Buscadores (regla del repositorio, 24-sep-2026):** todo buscador del CRM, actual o nuevo,
  ignora acentos, ñ y mayúsculas con `lib/text/search.ts` (`matchesSearch` / `normalizeSearch`;
  en el servidor, la misma normalización en SQL con `lower(translate(...))` usando
  `SQL_SEARCH_FROM/TO`, sin extensión `unaccent`). **Prohibido** filtrar con
  `toLowerCase().includes` o `ilike` directo. La prueba guardiana
  `lib/text/search-guard.test.ts` falla si aparece uno; la única excepción anotada es el filtro de
  comandos del composer (Fase D).
- **Seguimiento del Agente IA (2-oct-2026, decisión del dueño):** píldora 🤖 **en el hueco de la barra arriba de ⚡ 📄
  📎** (no agranda la barra; en el celular al final del renglón de iconos; con la ventana cerrada, junto a "Enviar
  plantilla"), solo cuando el chat tiene seguimiento; abre su burbuja (Ver mensaje · Cambiar hora · Lo mando yo · Cancelar
  y, en una sugerencia, Que salga solo). No va en el Detalle del contacto. Horas en la hora del cliente según su lada, de
  7:00 a 21:00 todos los días; plantillas hasta las 19:00. Código: `followup-pill.tsx`, `lib/followups/`.
  Plantillas propias por caso (3-oct-2026, textos del dueño TAL CUAL): `seg_precio`, `seg_informacion`, `seg_valorar`,
  `seg_medidas`, `seg_asesor`, `seg_objecion` y `seg_info_duda` (3-oct, 2.º intento de solo información); en `seg_precio`, `seg_informacion`, `seg_info_duda`, `seg_valorar` y `seg_medidas` `{{1}}` = CUÁNDO escribió el cliente ("anoche",
  "antier"…, `lib/followups/time-phrase.ts`), no el nombre, también en el 📄 y el 🕒. Salen solo ya aprobadas por Meta.
- **Búsqueda en los chats (29-sep-2026, decisión del dueño):** una **lupa** entre el buscador y el
  filtro (Bandeja y Embudo). Prendida se pinta de amarillo y el MISMO campo busca una palabra dentro
  de los mensajes de todos los chats (cliente, vendedor, Agente IA, historial importado, pies de foto
  y transcripciones; fuera los avisos internos 📝 y los comentarios del contacto), mínimo 3 letras.
  Solo quedan los contactos con la palabra, con un **círculo amarillo** (cuántos mensajes) junto al
  naranja de no leídos; en el chat la palabra va resaltada en amarillo, con la barra «1 de N» ↑ ↓
  y salto a la coincidencia más reciente. Amarillos = los de la tarjeta amarilla, pero sólidos, con
  el texto `#1e2a35`, iguales en claro y oscuro (tokens `--busqueda*` en `app/globals.css`). SQL en
  `lib/inbox/chat-search.ts`, índice de trigramas (`pg_trgm`) de la migración 0050. Detalle:
  `docs/bandeja.md` › "Búsqueda en los chats".
- **Aviso de actualización (1-oct-2026, decisión del dueño):** «Hay una nueva actualización del CRM: recarga la
  página» + **Recargar**, en la barra de arriba (píldora; en celular, franja azul debajo). Sale **solo** cuando falló
  algo que hizo el vendedor (petición al CRM hasta 3 s después de un gesto suyo: clic, tecla, archivo, soltar, pegar)
  y `/api/version` dice que el servidor ya tiene otra versión que la pestaña. Nunca sale solo por haber versión nueva
  ni por un refresco automático (en una pestaña vieja también pueden fallar los refrescos si la versión nueva cambió
  sus acciones o archivos; sin esos cambios, la pestaña vieja sigue funcionando y no hay nada que avisar). Versión = `RAILWAY_GIT_COMMIT_SHA` fijada en el build (`next.config.ts`); código en
  `lib/version/` (vigilancia instalada desde `instrumentation-client.ts`) y `app/(app)/_components/update-notice.tsx`.
- **Paneles que se ocultan** (lista y Detalle de la Bandeja, Detalle del pop-up del Embudo):
  se recuerdan por computadora con `components/ui/use-persistent-toggle.ts` (localStorage con
  try/catch; sin almacenamiento, abierto por defecto; sin parpadeo). Cualquier panel nuevo que se
  pueda ocultar usa ese hook.
- **Cursor y letras al escribir** (2-oct-2026, decisión del dueño): en TODA caja de texto, mientras se
  escribe, cursor azul de 2 px (`--cursor-escritura`), parpadeo suave, se desliza solo en los saltos y las
  letras nuevas entran con desvanecido. Una sola pieza global (`lib/escritura/client.ts`, instalada en
  `instrumentation-client.ts`): pone una capa encima de la caja enfocada y la quita al salir; la caja
  (bordes, colores, iluminación) no cambia. Fuera: celular/tableta, «Reducir movimiento», contraseña,
  correo, número y fechas. Una caja nueva no necesita nada; para excluir una, `data-sin-escritura` en ella
  o en un ancestro.
- **Indicador "Agente IA leyendo/escribiendo/enviando"** (píldora en el chat,
  `app/(app)/dashboard/_components/agent-activity-pill.tsx`, lector `lib/agente-ia/activity*.ts`,
  orbe del paquete `thinking-orbs` 0.3.2 fijo): depende de DOS contratos de Fase D que no se
  cambian sin actualizarlo: (1) en la cola BullMQ `agent-replies` el **jobId = conversationId**
  (`lib/ai/runtime/queue.ts`); (2) `workflow_runs.trigger` ∈ `agent|keyword|command|stage` y
  `status` `queued|running` = corrida abierta (`lib/db/schema/automation.ts`). Lee la cola con
  `withQueueTimeout` (1.5 s); si Redis falla, muestra nada.
- **Enlaces** (estilo propio en `app/globals.css`, sin el fondo iluminado de los botones):
  `data-link="text"` (subrayado que se dibuja + navy más intenso), `data-link="card"`
  (tarjeta-enlace: borde navy, sombra, sube 1 px; su flecha lleva `data-link-arrow`),
  `data-link="tab"` (pestaña-enlace: fondo navy tenue). Un enlace con forma de botón sólido lleva
  `data-glow`. Al llegar Anuncios a `main`: la tarjeta "Llegó por anuncio" y la lista de
  `/anuncios` llevan `data-link="card"`, "Ver en Meta" lleva `data-link="text"`. La tabla de
  anuncios (`components/anuncios/ads-table.tsx`, contrato en `docs/ui-anuncios-tabla.md`)
  reemplaza la lista de `/anuncios` con luz verde del dueño.
- **Mapa del CRM (26-sep-2026):** `docs/mapa-crm.md` es la guía del dueño (nombre y número de cada
  elemento de cada pantalla). Todo cambio que toque la interfaz actualiza esa guía y su captura en
  `docs/mapa-crm/` **en el mismo commit**, conservando los números existentes; lo nuevo toma el
  siguiente número libre de su sección (nunca se renumera). Capturas solo con datos de ejemplo.

---

## 7. Convenciones de código

- TypeScript `strict: true`. Prohibido `any`.
- Server Actions para mutaciones; API routes solo para webhooks y endpoints públicos.
- Toda consulta a DB filtra por `organization_id`. Helper `withOrg(ctx)` obligatorio, sin excepciones.
- Errores de proveedor nunca se tragan: se guardan en `messages.error_code` y se muestran en la UI.
- Un archivo = una responsabilidad. Componentes de UI sin lógica de datos.
- Migraciones: nunca editar una migración ya aplicada; siempre una nueva. **Candado** (25-sep-2026,
  docs/migraciones.md): `npm run db:check` falla si falta CUALQUIER migración del journal (drizzle salta en
  silencio las de `when` menor); corre en el pre-deploy de Railway, así un faltante detiene el despliegue
  sin tumbar la versión que está atendiendo.
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
- **Dónde vive el trabajo en esta Mac (25-sep-2026):** todo en `~/Documents/Diluvium CRM/` — copia
  principal del repo en `crm-diluvium/`, un worktree por chat en `chats/`, medios en `media/` y archivos
  del CRM fuera del repo en `notas/` (qué hay en cada una: `LEEME.md` de esa carpeta). Nada de eso va
  DENTRO del repo (datos de clientes y del banco).
- **Nunca dos agentes sobre los mismos archivos.** Usar git worktrees, siempre dentro de
  `~/Documents/Diluvium CRM/chats/` (una carpeta por chat de Code; el nombre lleva espacio: siempre entre
  comillas; mapa completo en `docs/migrar-mac.md`):
  ```
  git worktree add "$HOME/Documents/Diluvium CRM/chats/crm-inbox"    -b feature/inbox    origin/main
  git worktree add "$HOME/Documents/Diluvium CRM/chats/crm-contacts" -b feature/contacts origin/main
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
   El limiter de fábrica de Better Auth queda apagado. Candado por correo (S3, 30-sep-2026): 10
   intentos en 5 min por correo + IP y tope de 50/h por correo; fallos y bloqueos se registran
   (`auth_failed`/`auth_locked`, correo con hash) y 3+ bloqueos/h abren el issue del monitor. Por
   HTTP solo se atienden `/sign-in/email`, `/sign-out` y `/get-session` (lib/auth/allowed-routes.ts).
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
