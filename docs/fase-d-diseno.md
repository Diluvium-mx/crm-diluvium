# Agente IA — Fase D: Acciones y Automatización (diseño)

> Estado: **DISEÑO, pendiente de aprobación del dueño (23-sep-2026)**. Sin código, sin
> migraciones. Rama `feat/agente-ia-fase-d` (desde main 086143d). Cuando se apruebe, se
> construye SOLO la parte (a) (§7); la parte (b) espera al cierre de la Fase B y a un rebase.

## 0. Qué resuelve

Lo que hoy hace Ángela en GoHighLevel además de contestar texto: mandar la tabla de tamaños,
los datos bancarios, los videos de instalación, el material de tapones, explicar dónde medir,
pasar a humano y mover al contacto de etapa. Todo eso se vuelve **workflows** (secuencias de
pasos) que viven en la base, se administran en una pestaña nueva **Automatización** y se
disparan de tres formas: por decisión del agente (tool-calling), por palabra clave / comando
en el chat, o por cambio de etapa. El material (imágenes/videos) vive en una **biblioteca de
media** en el bucket `crm-media` de Railway. Nada de terceros.

Punto de partida verificado en el código (main 086143d):

- `callModel` ya acepta `tools` (AI SDK v7, `lib/ai/types.ts`) y el adaptador Anthropic las
  pasa a `generateText`; el runtime todavía no las usa. El cerebro señala "pasar a humano" con
  el token `[TRANSFERIR]` y el sufijo del system dice que videos/tablas/datos bancarios "aún no
  están disponibles" (`lib/ai/runtime/brain.ts`).
- **El CRM no envía media saliente.** `MessagingProvider` (`lib/messaging/provider.ts`) solo
  tiene `sendText` y `sendTemplate`; `lib/messaging/send.ts` igual. Entrante sí: los adjuntos se
  descargan al bucket (`storageKey`) y hay URL firmada de lectura (`lib/storage/s3.ts`).
- La etapa vive en `contacts.stage` (`inbox → prospecto → interesado → cerca_compra → compra`)
  y se cambia con `updateContactStage` (`lib/actions/contacts.ts`), que hoy no deja rastro en
  `activities`.
- El agente ya deja etiquetas de rastro en el contacto y pausa por conversación
  (`agent_state`). Los borradores (`ai_agent_drafts`) guardan solo burbujas de texto.

## 1. Workflows v1 (predeterminados, ~10)

Disparador "agente" = el cerebro decide llamarlo (§2). "Clave" = el cliente escribe una de las
palabras clave configuradas. "Comando" = el vendedor escribe `/algo` en el composer. "Etapa" =
el contacto entra a esa etapa (arrastre en el Embudo, panel de contacto o el propio agente).

| # | Workflow (slug) | Disparador v1 | Pasos (acción) | Media que usa |
|---|---|---|---|---|
| 1 | `tabla_tamanos_estandar` | agente · comando `/tabla` · clave "tabla", "tamaños" | texto corto + **imagen** | `tabla-tamanos-estandar.png` |
| 2 | `tabla_tamanos_mini` | agente · comando `/mini` | texto corto + **imagen** | `tabla-tamanos-mini.png` |
| 3 | `datos_bancarios` | agente (cliente eligió transferencia/depósito) · comando `/banco` | texto + **imagen** de datos bancarios + etapa → `cerca_compra` · **una vez por conversación** | `datos-bancarios.png` |
| 4 | `video_instalacion_estandar` | agente · comando `/video` | texto + **video como archivo** | `instalacion-estandar.mp4` |
| 5 | `video_instalacion_medida` | agente · comando `/video-medida` | texto + **video como archivo** | `instalacion-medida.mp4` |
| 6 | `tapones_inflables` | agente · comando `/tapones` · clave "tapón", "tapones" | texto + 1–3 **imágenes** + **video** | `tapones-1.png`, `tapones-2.png`, `tapones.mp4` |
| 7 | `donde_medir` | agente · comando `/medir` | texto (cómo medir de lateral a lateral) + **imagen** guía | `donde-medir.png` |
| 8 | `medidas_especiales` | agente (entrada > 250 cm, poste central, ∼280 cm) | texto + **imagen** (diagrama poste/dos compuertas) | `medidas-especiales.png` (opcional) |
| 9 | `transferir_humano` | agente (reglas del Goal) · comando `/humano` | pasar a humano (etiqueta "pasar a humano" + pausa 8 h, igual que hoy) + etiqueta opcional | — |
| 10 | `cambiar_etapa` | agente · clave (configurable) | etapa → destino (el agente solo puede mover a `prospecto`, `interesado` y `cerca_compra`; **`compra` nunca la pone el agente**) | — |
| 11 | `comprobante_recibido` (propuesto) | agente (el cliente mandó imagen de transferencia) | texto de confirmación + etiqueta "comprobante" + pasar a humano (verificación del pago) | — |

Reglas transversales (vienen del Goal de Ángela):
- "Responde primero la duda, después activa la tabla/video": el texto del cerebro sale
  **antes** que las acciones.
- "No vuelvas a enviar contenido ya compartido": todo workflow tiene `once_per_conversation`;
  para 1–8 arranca en **sí** (se puede volver a mandar con comando del vendedor). El agente ve
  en su contexto qué workflows ya salieron en esa conversación.
- Un workflow con un paso de media cuyo archivo falta queda **deshabilitado** y no se ofrece
  al agente ni a los comandos (la pestaña lo marca en ámbar).

## 2. Cómo los dispara el agente y cómo convive con la guardia y los modos

**Tool-calling con el cerebro (Sonnet 5 por default).** En cada llamada al cerebro se declaran
herramientas (AI SDK `tools`, esquema Zod → JSON Schema **strict** con `additionalProperties:
false` y `required`):

- **Una herramienta por workflow habilitado con disparador "agente"**: nombre `wf_<slug>`,
  descripción = campo **"Cuándo usarlo"** del workflow (editable por admin). Así el admin
  controla cuándo se dispara sin tocar el Goal. Sin parámetros (`{}`) salvo `cambiar_etapa`
  (`{ etapa }`, enum acotado) y `transferir_humano` (`{ motivo }`, texto corto para la tarjeta).
- `tool_choice: auto` **siempre**. No se fuerza ninguna herramienta (Opus 5.5 y Fable 5.1
  devuelven 400 con `any`/`tool`; Sonnet 5 lo permite pero no hace falta). El system dice
  explícitamente "responde con texto y, si aplica, llama a la herramienta". `strict` garantiza
  argumentos válidos; no se necesitan structured outputs porque el texto libre sigue siendo la
  respuesta al cliente.
- **Las herramientas se declaran sin `execute`** (deferred): el modelo devuelve en UNA sola
  respuesta el texto + las llamadas; el runtime NO deja que el SDK ejecute nada dentro del bucle
  del modelo (hoy el adaptador usa `stopWhen: isStepCount(4)`; con tools sin `execute` termina
  en el paso 1). Es decir: **una llamada, cero ejecución dentro del modelo**; el gasto no crece.
- Orden estable de herramientas (por `position`) para no romper la caché del prompt: en la
  API las tools van antes del system, así que solo cambian al habilitar/deshabilitar un
  workflow.
- `[TRANSFERIR]` se mantiene como respaldo: si el modelo lo escribe en texto, sigue siendo
  handover (compatibilidad con el Goal actual).

**Flujo en el runtime (parte b):** filtro → cerebro → `parseBrainOutput(text)` + `toolCalls[]`
→ validar cada llamada contra los workflows habilitados de la organización (una herramienta
desconocida o deshabilitada se ignora y se registra) → **guardia de salida sobre el texto,
igual que hoy** → burbujas → después las acciones, en el orden en que el modelo las pidió.

**Guardia de salida.** No cambia (está congelada). El texto del modelo pasa por `reviewReply`
tal cual. Los pasos de un workflow (textos, pies de foto) son **contenido escrito por el admin**,
no salida del modelo: no pasan por la guardia. Consecuencia útil: los datos bancarios dejan de
ser un handover y viajan en una imagen que el modelo nunca escribe. Con `cambiar_etapa` la
lista permitida es cerrada y `compra` nunca está en ella. Si la guardia retiene el texto, se
retienen también las acciones (van juntas en el borrador).

**Modos por canal.**
- **Apagado:** el agente no llama modelos ni dispara nada (regla de la Fase B: OFF no toca
  nada). Los disparadores de palabra clave del **cliente** tampoco corren. Los **comandos del
  vendedor** y los disparos por **cambio de etapa hecho por un humano** sí, porque son acciones
  humanas, y salen con `source: "crm"`.
- **Borrador:** el borrador guarda `bubbles` + `actions` (jsonb: la lista de workflows/pasos a
  ejecutar). La tarjeta muestra "Enviará: 📎 tabla de tamaños · ↗ etapa Interesado". Aprobar
  manda las burbujas y luego ejecuta las acciones como una corrida del workflow (`trigger:
  draft_approval`, con el usuario que aprobó). Descartar descarta todo.
- **Auto:** después de las burbujas, cada acción vuelve a leer el estado fresco (mismo
  `stopBeforeBubble`: canal en auto, agente activo, sin salientes humanos nuevos) antes de
  ejecutarse; si un vendedor respondió a la mitad, lo que falta no sale.
- Media sale con `source: "ai_agent"` (agente) o `"crm"` (comando/etapa), así el semáforo,
  `first_response_seconds` y las pausas por "respuesta humana" siguen funcionando igual.

**Ventana de 24 h.** Media y texto libre solo dentro de la ventana; fuera de ella el workflow
falla con `error_code: ventana_24h` visible en la corrida (no se manda plantilla automática en
v1; eso es Fase C).

## 3. Modelo de datos y permisos

Tablas nuevas (todas con `organization_id`, migración **0025**, en la parte a):

```
media_assets        id, org_id, kind (image|video|document), title, file_name, mime_type,
                    bytes, sha256, storage_key, width, height, duration_seconds,
                    created_by_user_id, created_at, deleted_at (soft)
                    -- bucket: org/{org_id}/library/{asset_id}-{slug}. Índice (org_id, deleted_at).

workflows           id, org_id, slug (único por org), name, agent_description ("Cuándo usarlo",
                    va a la descripción de la tool), enabled, is_system (predeterminado: no se
                    borra, sí se edita), trigger_agent (bool), trigger_keywords text[],
                    trigger_command (p. ej. "/tabla", único por org), trigger_stage
                    (contact_stage, nullable), once_per_conversation, position,
                    created_by_user_id, updated_by_user_id, updated_at

workflow_steps      id, org_id, workflow_id, position,
                    kind (send_text | send_media | set_stage | handover | add_tag | wait),
                    payload jsonb (Zod por kind):
                      send_text  { text }                  -- admite {{nombre}}, {{vendedor}} como los Fragmentos
                      send_media { asset_id, caption? }
                      set_stage  { stage }                 -- enum contact_stage
                      handover   { tag? }                  -- reutiliza pausa + etiqueta de la Fase B
                      add_tag    { tag }
                      wait       { seconds }               -- 1–30 s entre burbujas

workflow_runs       id, org_id, workflow_id, conversation_id, contact_id,
                    trigger (agent | keyword | command | stage | draft_approval),
                    triggered_by_user_id (nullable), draft_id (nullable),
                    status (queued | running | done | failed | cancelled), step_cursor,
                    message_ids jsonb, error_code, created_at, finished_at
                    -- índice (conversation_id, workflow_id, status) para once_per_conversation
                    -- y para el contexto "ya enviado" del agente.
```

Cambios en tablas existentes:
- `ai_agent_drafts.actions jsonb` (nullable) — parte **b** (lo escribe el runtime).
- `messages`: sin cambios de columnas. Un envío de media es un `messages` con `type`
  image/video/document, `attachments[{storageKey, mimeType, fileName}]` y `source` crm/ai_agent;
  el run guarda los `message_ids`.
- `activities`: cada corrida deja `workflow.run` y cada cambio de etapa `contact.stage_changed`
  (también el manual; hoy no se registra).

Qué va al bucket: solo los archivos de la biblioteca (y lo que ya va hoy: adjuntos entrantes).
Subida directa navegador → bucket con **URL firmada de PUT** (evita el límite de body de las
Server Actions con videos de 16 MB); el server action `confirmAsset` valida con `HEAD`
(mime/bytes) antes de dar de alta la fila. Envío: URL firmada de GET de corta vida al
proveedor (**supuesto a verificar en el sandbox, primer spike de la parte a:** el endpoint
`/v1/inbox/conversations/{id}/messages` de Zernio acepta media por `link`, como la Cloud API;
si no, subir por `/v1/whatsapp/media` y enviar por id).

Permisos (`lib/auth/permissions.ts`):

| Recurso | owner/admin | agent (vendedor) |
|---|---|---|
| `workflow` | read, run, create, update, delete | read, **run** |
| `mediaAsset` | read, create, delete | read |

La pestaña **Automatización** (`/automatizacion`) es solo owner/admin (como "Agente IA"). Los
vendedores los **usan** desde el composer: en el menú "/" aparece una sección "Automatizaciones"
junto a Fragmentos, y los comandos `/tabla`, `/banco`, … Nada de asignaciones ni datos extra
(regla "menos datos es mejor").

## 4. Editor v1 (rápido)

**Lista + formulario por pasos. Sin lienzo.**

- **Lista**: tarjetas ordenables (dnd-kit, ya en el stack) con nombre, disparadores como chips,
  interruptor habilitado, aviso ámbar "falta archivo", y corridas de los últimos 7 días.
- **Formulario** (una página por workflow): Nombre · "Cuándo usarlo" (texto que ve el agente)
  · Disparadores (agente ✓ / palabras clave / comando / etapa) · "Una vez por conversación" ·
  **Pasos**: lista ordenable de tarjetas; botón "+ paso" con 6 tipos (Texto, Archivo, Etapa,
  Pasar a humano, Etiqueta, Esperar). El paso Archivo abre el **selector de biblioteca**
  (subir / elegir / vista previa firmada).
- **Biblioteca** (sub-pestaña): grid de imágenes/videos con subir, renombrar, borrar (soft; no
  se borra si un paso lo usa).
- **Probar**: botón que ejecuta el workflow contra una conversación del canal sandbox como
  comando del vendedor (misma ruta que `/tabla`).
- Sin versiones, sin ramas condicionales, sin variables más allá de `{{nombre}}` /
  `{{vendedor}}`. El lienzo visual de arrastrar y las condiciones quedan para v2.

## 5. Archivos de media que necesito (los consigue el dueño)

Límites de WhatsApp (Cloud API) que aplican vía Zernio:

| Tipo | Formato | Tope | Recomendación |
|---|---|---|---|
| Imagen | JPEG o PNG (sin transparencia) | 5 MB | 1080–1600 px de ancho, texto legible en celular |
| Video | MP4, H.264 + AAC | 16 MB | 720p, ≤ 60–90 s; comprimir si pasa de 16 MB |
| Documento | PDF | 100 MB | solo si la tabla también se quiere como PDF |

Archivos:
1. `tabla-tamanos-estandar.png` — tabla de tamaños compuerta estándar (XCH…XG, 69–120 cm).
2. `tabla-tamanos-mini.png` — tabla mini (XXCH…XXG, 62–123 cm, altura 30 cm).
3. `datos-bancarios.png` — la foto de datos bancarios que hoy manda Ángela (banco, CLABE,
   beneficiario). Va al bucket privado; nunca al repo.
4. `instalacion-estandar.mp4` y 5. `instalacion-medida.mp4` — los videos que hoy manda GHL
   **como archivo** (si GHL los tiene como enlace de YouTube/Drive, necesito el MP4 original).
6. `tapones-1.png`, `tapones-2.png` (2–3 imágenes) y `tapones.mp4`.
7. `donde-medir.png` — imagen/diagrama de dónde medir (lateral a lateral, en el punto de apoyo).
8. `medidas-especiales.png` — opcional: poste central + dos compuertas / ∼280 cm.
9. **Los textos** que acompañan a cada workflow en GHL (exportar tal cual de cada workflow de
   Ángela) y la lista de **palabras clave** que hoy usan en GHL.

## 6. Riesgos y supuestos

- **Zernio y media saliente**: no verificado. Spike de 1 día contra el sandbox antes de
  construir el ejecutor. Si Zernio no acepta media, se documenta y la Fase D queda en textos +
  etapa + humano hasta resolverlo (decisión del dueño).
- **Sandbox**: 50 msg/día; los videos consumen igual que un texto, pero cuidado con las
  pruebas repetidas.
- **Costo**: cada tool declarada suma tokens al prompt (≈ 60–120 por tool, ~10 tools). Va antes
  del system y se cachea mientras no cambie la lista.
- **Comportamiento**: el modelo puede llamar la herramienta sin texto o el texto sin la
  herramienta. El system pide "texto + herramienta"; en borrador se ve y se corrige la
  descripción "Cuándo usarlo" sin tocar código.
- **Datos bancarios**: hoy el Goal pide handover; con la imagen se automatiza. Sigue la regla
  del Goal: tras un comprobante no se reenvían (once_per_conversation + contexto "ya enviado").

## 7. Plan en pasos chicos

### (a) NO toca `lib/ai/runtime` ni los archivos del agente

| Paso | Entregable | Toca |
|---|---|---|
| A0 | **Spike Zernio media** en el sandbox (script en scratchpad; nada en el repo salvo notas en `docs/investigacion/media-zernio.md`) | — |
| A1 | Migración **0025**: `media_assets`, `workflows`, `workflow_steps`, `workflow_runs`; ACL `workflow` / `mediaAsset`; seed de los ~10 predeterminados (deshabilitados hasta tener archivo) | `lib/db/schema/automation.ts`, `drizzle/0025_*`, `lib/auth/permissions.ts` |
| A2 | **Biblioteca de media**: PUT firmado, `confirmAsset`, listar, borrar; validación mime/tamaño; tests puros de claves y validación | `lib/storage/s3.ts` (+PUT), `lib/media-library/*` |
| A3 | **Media saliente**: `sendMedia` en `MessagingProvider` + Zernio + `sendMediaMessage` en `send.ts` (idempotente, mismo contrato de fallo) | `lib/messaging/provider.ts`, `zernio.ts`, `send.ts` |
| A4 | **Ejecutor**: `lib/workflows/executor.ts` + job BullMQ `workflow.run` (pasos secuenciales, cursor, reintento por paso, `ventana_24h`, `once_per_conversation`, `activities`) + `runWorkflow()` server action | `lib/workflows/*`, `worker/*` |
| A5 | **Pestaña Automatización** (`/automatizacion`): lista, formulario, pasos, selector de biblioteca, "Probar" | `app/(app)/automatizacion/*`, `app/(app)/layout.tsx` |
| A6 | **Disparadores humanos y de cliente**: comandos y sección en el menú "/" del composer; palabras clave del cliente como hook propio en `ingest.ts` (aislado, try/catch, respeta modo del canal); disparo por etapa en `updateContactStage` y en el arrastre del Embudo; rastro en `activities` | `lib/inbox/*`, `lib/messaging/ingest.ts`, `lib/actions/contacts.ts` |
| A7 | Gate: revisión adversarial Claude + cyber-neo + `/codex:adversarial-review --base main`; typecheck/test/lint; prueba de `/tabla` y `/banco` en el sandbox | — |

Cada paso es una rebanada vertical desplegable; A5 ya se puede usar (con comandos) sin el agente.

### (b) Enganche con el agente (espera el cierre de la Fase B → rebase sobre main)

| Paso | Entregable | Toca |
|---|---|---|
| B1 | Rebase de `feat/agente-ia-fase-d` sobre main; migración `ai_agent_drafts.actions` | `drizzle/0026_*` |
| B2 | `toolCalls` en `CallModelResult`; tools sin `execute` (una sola vuelta); `strict` | `lib/ai/types.ts`, `providers/*`, `index.ts` |
| B3 | Tools dinámicas desde `workflows` + `cambiar_etapa` + `transferir_humano`; system: quitar las líneas "todavía no disponible" y agregar la regla "texto primero, luego herramienta" | `lib/ai/runtime/brain.ts`, `tools.ts` (nuevo) |
| B4 | `run.ts`: texto → guardia → burbujas → acciones (auto con relectura de estado; borrador con `actions`; aprobar = corrida `draft_approval`) | `lib/ai/runtime/run.ts`, `state.ts`, `manual.ts` |
| B5 | Contexto "ya enviado en esta conversación" (lee `workflow_runs`) y tarjeta de borrador con acciones | `lib/ai/runtime/context.ts`, UI de borradores |
| B6 | Gate completo + prueba en **BORRADOR** en `ch_zernio_sandbox`; AUTO solo con OK del dueño | — |
