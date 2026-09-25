# Agente IA — Fase D: Acciones y Automatización (diseño)

> Estado: **APROBADO por el dueño el 23-sep-2026** con las definiciones de negocio de §0.1.
> Rama `feat/agente-ia-fase-d` (desde main 086143d). **Parte (a) construida el 23-sep-2026**
> (A0–A6; §8 tiene las decisiones de implementación). La parte (b) espera al cierre de la
> Fase B y a un rebase sobre main.

## 0. Qué resuelve

Lo que hoy hace Ángela en GoHighLevel además de contestar texto: mandar la tabla de tamaños,
los datos bancarios, los videos de instalación, el material de tapones, explicar dónde medir,
confirmar comprobantes de pago, pasar a humano y mover al contacto de etapa. Todo eso se vuelve
**workflows** (secuencias de pasos) que viven en la base, se administran en una pestaña nueva
**Automatización** y se disparan de tres formas: por decisión del agente (tool-calling), por
palabra clave / comando en el chat, o por cambio de etapa. El material (imágenes/videos) vive en
una **biblioteca de media** en el bucket `crm-media` de Railway. Nada de terceros.

### 0.1 Definiciones del dueño (23-sep-2026) — mandan sobre el resto del documento

1. **El agente trabaja siempre en AUTO.** El modo "borrador" **ya no existe** (Fase B 3 lo
   quitó junto con la guardia de salida): para el agente y las palabras clave del cliente,
   cualquier valor del canal distinto de `auto` es apagado. Las acciones se ejecutan directo
   en la conversación.
2. **Etapas:** el agente mueve al contacto por **todas** las etapas del Embudo según el
   contexto del chat, **incluida "Compra"** cuando él mismo cierra la venta. Ejemplos: datos
   bancarios → "Cerca de compra"; pago confirmado → "Compra".
3. **Comprobante de pago:** el agente analiza la foto (monto, fecha, banco, referencia)
   contra lo cotizado en la conversación y confirma el pago, como Ángela en GHL.
   Si el monto no cuadra o la imagen no es un comprobante legible, se lo dice al cliente con
   amabilidad y pasa a humano. Al confirmar un pago deja además un **aviso visible para el
   vendedor** en la conversación para cotejar el depósito en el banco antes de enviar, sin
   frenar al cliente.
4. **Textos y palabras clave** de cada workflow los redacta Claude a partir del Goal y las 47
   FAQs; el dueño los revisa después en el editor.
5. **Archivos de media:** el dueño los tiene todos; se piden con lista exacta y carpeta fuera
   del repo (p. ej. `~/Documents/diluvium-media`). Mientras tanto, archivos de prueba.
6. **Sin guardia de salida ni módulo de montos** (decisión del 24-sep-2026): la Fase B 3 quitó
   la guardia; el diseño de "montos ya vistos" (§2.3 original) queda **descartado** y su módulo
   se eliminó. El comprobante se confirma con **monto + referencia no repetida** (24-sep, 2.ª decisión:
   sin cotejo de destinatario/CLABE; la sección "Datos de cobro" y la tabla `datos_cobro` se eliminaron
   en la 0029; los datos bancarios existen SOLO como imagen en el workflow "Datos bancarios").
7. **Sin "una vez por conversación"** (24-sep-2026): el CRM no bloquea repetir un contenido; el
   agente decide con el contexto (el Goal le pide no repetir) y el vendedor repite con el comando.

### 0.2 Punto de partida verificado en el código (main 086143d)

- `callModel` ya acepta `tools` (AI SDK v7, `lib/ai/types.ts`) y el adaptador Anthropic las
  pasa a `generateText`; el runtime todavía no las usa. El cerebro señala "pasar a humano" con
  el token `[TRANSFERIR]` y el sufijo del system dice que videos/tablas/datos bancarios "aún no
  están disponibles" (`lib/ai/runtime/brain.ts`).
- **El CRM no envía media saliente.** `MessagingProvider` (`lib/messaging/provider.ts`) solo
  tiene `sendText` y `sendTemplate`; `lib/messaging/send.ts` igual. Entrante sí: los adjuntos se
  descargan al bucket (`storageKey`) y hay URL firmada de lectura (`lib/storage/s3.ts`).
- La etapa vive en `contacts.stage` (`inbox → prospecto → interesado → cerca_compra → compra`)
  y se cambia con `updateContactStage` (`lib/actions/contacts.ts`). No existe todavía una
  tabla `activities`: el rastro de la Fase D queda en `workflow_runs`.
- El agente ya deja etiquetas de rastro en el contacto y pausa por conversación
  (`agent_state`).

### 0.3 Spike de media saliente por Zernio (hecho el 23-sep-2026, sandbox)

Se mandaron 3 mensajes de prueba al teléfono del dueño por `POST
/v1/inbox/conversations/{id}/messages` (cuenta sandbox, sin tocar ninguna base):

| Variante | Resultado |
|---|---|
| Imagen PNG por `attachmentUrl` + `attachmentType: "image"` + `message` (URL temporal de `POST /v1/media/upload-direct`, multipart, tope 25 MB, se borra a los 7 días) | 200, `messageId` = wamid |
| Video MP4 (H.264/AAC, 5 s, 0.5 MB) por `attachmentUrl` + `attachmentType: "video"` | 200, llega **como archivo de video** |
| Imagen por **URL firmada de 15 min de nuestro bucket** de staging (`t3.storageapi.dev`, query de 456 caracteres) | 200: **esta es la ruta del diseño** |
| Objeto `media: { url, type, caption }` (aparece en la guía del inbox) | 400 `missing_required_field`: **no usar** |

Conclusiones: el cuerpo real es `attachmentUrl` / `attachmentType` (`image` | `video` |
`audio` | `file`) / `attachmentName` (nombre del documento) / `message` (texto que acompaña);
`Idempotency-Key` funciona igual que en texto. Zernio exige que la URL sea pública y devuelva
el archivo: la URL firmada de GET del bucket cumple (sin encabezados de auth). Límites de
WhatsApp: imagen JPEG/PNG 5 MB; video MP4/3GPP H.264+AAC 16 MB; documento 100 MB. `upload-direct`
no es necesario: se guarda una sola vez en nuestro bucket y se firma en cada envío.

## 1. Workflows v1 (predeterminados)

Disparador "agente" = el cerebro decide llamarlo (§2). "Clave" = el cliente escribe una de las
palabras clave configuradas. "Comando" = el vendedor escribe `/algo` en el composer. "Etapa" =
el contacto entra a esa etapa (arrastre en el Embudo, panel de contacto o el propio agente).

| # | Workflow (slug) | Disparador v1 | Pasos (acción) | Media que usa |
|---|---|---|---|---|
| 1 | `tabla_tamanos_estandar` | agente · comando `/tabla` · clave "tabla", "tamaños" | texto corto + **imagen** | `tabla-tamanos-estandar.png` |
| 2 | `tabla_tamanos_mini` | agente · comando `/mini` | texto corto + **imagen** | `tabla-tamanos-mini.png` |
| 3 | `datos_bancarios` | agente (cliente eligió transferencia/depósito) · comando `/banco` | **imagen** de datos bancarios con pie (el CRM deja al contacto en `cerca_compra` como regla interna, solo hacia adelante) | `datos-bancarios.png` |
| 4 | `video_instalacion_estandar` | agente · comando `/video` | texto + **video como archivo** | `instalacion-estandar.mp4` |
| 5 | `video_instalacion_medida` | agente · comando `/video-medida` | texto + **video como archivo** | `instalacion-medida.mp4` |
| 6 | `tapones_inflables` | agente · comando `/tapones` · clave "tapón", "tapones" | texto + 1–3 **imágenes** + **video** | `tapones-1.png`, `tapones-2.png`, `tapones.mp4` |
| 7 | `donde_medir` | agente · comando `/medir` | texto (cómo medir de lateral a lateral) + **video** guía como archivo | `donde-medir.mp4` |
| 7b | `video_instalacion_mini` | agente · comando `/video-mini` | texto + **video como archivo** | `instalacion-mini.mp4` |
| 8 | `medidas_especiales` | agente (entrada > 250 cm, poste central, ∼280 cm) | texto + **imagen** (diagrama poste/dos compuertas) | `medidas-especiales.png` (opcional) |
| ~~9 | `transferir_humano` | agente (reglas del Goal) · comando `/humano` | pasar a humano (aviso en el hilo; si lo dispara un vendedor con el comando, pausa `pausado_humano` hasta "Reactivar"; si lo dispara el agente, no lo pausa — Fase B 3) | — |~~ **ELIMINADO el 24-sep-2026 (§10): ya no es workflow; es acción interna del agente** |
| ~~10 | `cambiar_etapa` | agente · clave (configurable) | etapa → destino (cualquiera de las 5, incluida `compra`) | — |~~ **ELIMINADO el 24-sep-2026 (§10): ya no es workflow; es acción interna del agente** |
| ~~11 | `pago_confirmado` | agente (comprobante analizado y cuadra) | texto de confirmación al cliente + etapa → `compra` + etiqueta "cotejar depósito" + **aviso interno** al vendedor en la conversación | — |~~ **ELIMINADO el 24-sep-2026 (§10): ya no es workflow; es acción interna del agente** |
| ~~12 | `pago_no_cuadra` | agente (monto distinto / imagen ilegible / no es comprobante) | texto amable al cliente + pasar a humano con motivo | — |~~ **ELIMINADO el 24-sep-2026 (§10): ya no es workflow; es acción interna del agente** |

Reglas transversales (vienen del Goal de Ángela):
- "Responde primero la duda, después activa la tabla/video": el texto del cerebro sale
  **antes** que las acciones.
- "No vuelvas a enviar contenido ya compartido": lo aplica el **agente** con el contexto (ve en
  el hilo lo que ya salió); el CRM no lo bloquea (definición 7).
- Un workflow con un paso de media cuyo archivo falta queda **deshabilitado** y no se ofrece
  al agente ni a los comandos (la pestaña lo marca en ámbar).
- Los textos y palabras clave de 1–12 los redacta Claude (definición 4) en el seed de la
  migración; el dueño los ajusta en el editor.

## 2. Cómo los dispara el agente y cómo convive con la guardia y los modos

> **Superseded el 24-sep-2026 por el §10** (reestructura: el agente decide solo; el CRM no verifica
> montos; las acciones de etapa, aviso y comprobante son herramientas internas, no workflows). Lo
> que sigue en §2 se conserva como historia de diseño.

### 2.1 Tool-calling con el cerebro (Sonnet 5 por default)

En cada llamada al cerebro se declaran herramientas (AI SDK `tools`, esquema Zod → JSON Schema
**strict** con `additionalProperties: false` y `required`):

- **Una herramienta por workflow habilitado con disparador "agente"**: nombre `wf_<slug>`,
  descripción = campo **"Cuándo usarlo"** del workflow (editable por admin). Así el admin
  controla cuándo se dispara sin tocar el Goal. Sin parámetros (`{}`) salvo `cambiar_etapa`
  (`{ etapa }`, enum de las 5 etapas), `transferir_humano` (`{ motivo }`) y `pago_confirmado`
  (`{ monto, fecha, banco, referencia, destinatario }`: lo que leyó del comprobante, para el
  aviso interno).
- `tool_choice: auto` **siempre**. No se fuerza ninguna herramienta (Opus 5.5 y Fable 5.1
  devuelven 400 con `any`/`tool`; Sonnet 5 lo permite pero no hace falta). El system dice
  explícitamente "responde con texto y, si aplica, llama a la herramienta". `strict` garantiza
  argumentos válidos; no se necesitan structured outputs porque el texto libre sigue siendo la
  respuesta al cliente.
- **Las herramientas se declaran sin `execute`** (deferred): el modelo devuelve en UNA sola
  respuesta el texto + las llamadas; el runtime NO deja que el SDK ejecute nada dentro del bucle
  del modelo (hoy el adaptador usa `stopWhen: isStepCount(4)`; con tools sin `execute` termina
  en el paso 1). **Una llamada, cero ejecución dentro del modelo**; el gasto no crece.
- Orden estable de herramientas (por `position`) para no romper la caché del prompt: en la
  API las tools van antes del system, así que solo cambian al habilitar/deshabilitar un
  workflow.
- `[TRANSFERIR]` se mantiene como respaldo: si el modelo lo escribe en texto, sigue siendo
  handover (compatibilidad con el Goal actual).

**Flujo en el runtime (parte b):** filtro → cerebro → `parseBrainOutput(text)` + `toolCalls[]`
→ validar cada llamada contra los workflows habilitados de la organización (una herramienta
desconocida o deshabilitada se ignora y se registra) → **guardia de salida sobre el texto**
(§2.3) → burbujas → después las acciones, en el orden en que el modelo las pidió, cada una como
una `workflow_run` con `trigger: agent`. Antes de cada acción se relee el estado fresco (mismo
`stopBeforeBubble`: canal en auto, agente activo, sin salientes humanos nuevos); si un vendedor
respondió a la mitad, lo que falta no sale y la corrida queda `cancelled` con motivo.

### 2.2 Comprobante de pago (definición 3)

- El filtro ya ve imágenes (Fase B). Cuando el entrante trae una imagen y el contexto es de
  pago, el cerebro recibe la imagen (URL firmada, como hoy) y las instrucciones del system:
  extraer **monto, fecha, banco y referencia**, comparar contra **lo cotizado en la
  conversación** (el último total que el propio agente o el vendedor escribió) y decidir:
  - **Cuadra** (monto = total cotizado, 50 % o $3,500 de anticipo, o resto pendiente; referencia no
    repetida; sin regla de fecha ni de destinatario) → texto de confirmación + tool `pago_confirmado`
    con los datos leídos. El workflow pone etapa `compra` (o `cerca_compra` si fue anticipo del
    50 %), etiqueta "cotejar depósito" y escribe el **aviso interno**: una fila en `messages` con
    `direction: "out"`, `type: "system_note"` (nuevo), `source: "ai_agent"`, que la bandeja
    pinta como nota amarilla "Pago reportado: $X · banco · ref. … Cotejar en el banco antes de
    enviar" y que **no se manda por WhatsApp** (el proveedor nunca la ve). No bloquea al
    cliente: el agente sigue respondiendo dudas de envío.
  - **No cuadra o ilegible** → texto amable ("veo un comprobante por $X y el total es $Y…" /
    "no alcanzo a leer el comprobante, ¿me lo mandas de nuevo?") + tool `pago_no_cuadra` con el
    motivo → pasa a humano (aviso en el hilo con el motivo; el agente sigue activo hasta que un vendedor conteste — Fase B 3).
- Una vez confirmado un pago en la conversación, `datos_bancarios` no se vuelve a mandar
  (Goal) y un segundo comprobante va directo a humano (evita confirmar dos veces).
- El agente **nunca** confirma un pago sin imagen: "ya te transferí" en texto → responde que
  espera el comprobante.

### 2.3 Guardia de salida — DESCARTADA

La Fase B 3 eliminó la guardia de salida y el modo borrador. Este apartado y el módulo
"montos ya vistos" que lo acompañaba quedan sin efecto (24-sep-2026).

### 2.4 Modos por canal

- **Apagado:** el agente no llama modelos ni dispara nada (regla de la Fase B: OFF no toca
  nada). Los disparadores de palabra clave del **cliente** tampoco corren. Los **comandos del
  vendedor** y los disparos por **cambio de etapa hecho por un humano** sí, porque son acciones
  humanas, y salen con `source: "crm"`.
- **Cualquier otro valor del canal** cuenta como apagado para el agente y las palabras clave.
- **Auto:** lo descrito en §2.1.
- Media sale con `source: "ai_agent"` (agente) o `"crm"` (comando/etapa), así el semáforo,
  `first_response_seconds` y las pausas por "respuesta humana" siguen funcionando igual.

**Ventana de 24 h.** Media y texto libre solo dentro de la ventana; fuera de ella el workflow
falla con `error_code: ventana_24h` visible en la corrida (no se manda plantilla automática en
v1; eso es Fase C).

## 3. Modelo de datos y permisos

Tablas nuevas (todas con `organization_id`, migración **0027** (era la 0025; se renumeró dos veces al
rebasar, en la parte a):

```
media_assets        id, org_id, kind (image|video|document), title, file_name, mime_type,
                    bytes, sha256, storage_key, width, height, duration_seconds,
                    created_by_user_id, created_at, deleted_at (soft)
                    -- bucket: org/{org_id}/library/{asset_id}-{slug}. Índice (org_id, deleted_at).

workflows           id, org_id, slug (único por org), name, agent_description ("Cuándo usarlo",
                    va a la descripción de la tool), enabled, is_system (predeterminado: no se
                    borra, sí se edita), trigger_agent (bool), trigger_keywords text[],
                    trigger_command (p. ej. "/tabla", único por org), trigger_stage
                    (contact_stage, nullable), position,
                    created_by_user_id, updated_by_user_id, updated_at

workflow_steps      id, org_id, workflow_id, position,
                    kind (send_text | send_media | set_stage | handover | add_tag | internal_note | wait),
                    payload jsonb (Zod por kind):
                      send_text     { text }               -- admite {{nombre}}, {{vendedor}} como los Fragmentos
                      send_media    { asset_id, caption? }
                      set_stage     { stage }              -- enum contact_stage (las 5)
                      handover      { tag? }               -- aviso en el hilo; pausa solo si lo dispara un vendedor
                      add_tag       { tag }
                      internal_note { text }               -- aviso al vendedor; no sale por WhatsApp
                      wait          { seconds }            -- 1–30 s entre burbujas

workflow_runs       id, org_id, workflow_id, conversation_id, contact_id,
                    trigger (agent | keyword | command | stage),
                    triggered_by_user_id (nullable), payload jsonb (args de la tool),
                    status (queued | running | done | failed | cancelled | skipped), step_cursor,
                    message_ids jsonb, error_code, created_at, finished_at
                    -- índice (conversation_id, workflow_id, status): historial y exclusividad.
```

Cambios en tablas existentes:
- `messages.type` gana `system_note` (aviso interno: nunca se envía al proveedor; la bandeja lo
  pinta distinto). Parte a (lo usa el paso `internal_note`).
- `messages`: un envío de media es un `messages` con `type` image/video/document,
  `attachments[{storageKey, mimeType, fileName}]` y `source` crm/ai_agent; el run guarda los
  `message_ids`.
- `ai_agent_drafts`: **sin cambios** (definición 1).

Qué va al bucket: solo los archivos de la biblioteca (y lo que ya va hoy: adjuntos entrantes).
Subida directa navegador → bucket con **URL firmada de PUT** (evita el límite de body de las
Server Actions con videos de 16 MB); el server action `confirmAsset` valida con `HEAD`
(mime/bytes) antes de dar de alta la fila. Envío: URL firmada de GET de 15 min al proveedor
(verificado en §0.3).

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
  · Disparadores (agente ✓ / palabras clave / comando / etapa) ·
  **Pasos**: lista ordenable de tarjetas; botón "+ paso" con 7 tipos (Texto, Archivo, Etapa,
  Pasar a humano, Etiqueta, Aviso interno, Esperar). El paso Archivo abre el **selector de
  biblioteca** (subir / elegir / vista previa firmada).
- **Biblioteca** (sub-pestaña): grid de imágenes/videos con subir, renombrar, borrar (soft; no
  se borra si un paso lo usa).
- **Probar**: botón que ejecuta el workflow contra una conversación del canal sandbox como
  comando del vendedor (misma ruta que `/tabla`).
- **Corridas**: lista de las últimas corridas por workflow (estado, disparador, error).
- Sin versiones, sin ramas condicionales, sin variables más allá de `{{nombre}}` /
  `{{vendedor}}`. El lienzo visual de arrastrar y las condiciones quedan para v2.

## 5. Archivos de media (el dueño los tiene; se piden con lista y carpeta cuando toque)

Límites de WhatsApp (Cloud API) que aplican vía Zernio (verificado en docs.zernio.com):

| Tipo | Formato | Tope | Recomendación |
|---|---|---|---|
| Imagen | JPEG o PNG (sin transparencia) | 5 MB | 1080–1600 px de ancho, texto legible en celular |
| Video | MP4 o 3GPP, H.264 + AAC | 16 MB | 720p, ≤ 60–90 s; comprimir si pasa de 16 MB |
| Documento | PDF, DOC(X), XLS(X), PPT(X), TXT | 100 MB | solo si la tabla también se quiere como PDF |

Carpeta propuesta: `~/Documents/diluvium-media/` (fuera del repo). Archivos:
1. `tabla-tamanos-estandar.png` — tabla de tamaños compuerta estándar (XCH…XG, 69–120 cm).
2. `tabla-tamanos-mini.png` — tabla mini (XXCH…XXG, 62–123 cm, altura 30 cm).
3. `datos-bancarios.png` — la foto de datos bancarios que hoy manda Ángela. Va al bucket
   privado; nunca al repo.
4. `instalacion-estandar.mp4` y 5. `instalacion-medida.mp4` — los videos que hoy manda GHL
   **como archivo** (MP4 original).
6. `tapones-1.png`, `tapones-2.png` (2–3 imágenes) y `tapones.mp4`.
7. `donde-medir.mp4` — video de dónde medir (lateral a lateral, en el punto de apoyo). El dueño lo entrega después.
7b. `instalacion-mini.mp4` — video de instalación de la mini compuerta (entregado como .mov HEVC; convertido).
8. `medidas-especiales.png` — opcional: poste central + dos compuertas / ∼280 cm.

Hasta que lleguen, los seeds apuntan a **archivos de prueba** generados (PNG y MP4 de 5 s) y los
workflows con media quedan habilitados solo en el entorno de pruebas.

## 6. Riesgos y supuestos

- **Sandbox**: 50 msg/día; los videos consumen igual que un texto, pero cuidado con las
  pruebas repetidas.
- **Costo**: cada tool declarada suma tokens al prompt (≈ 60–120 por tool, ~12 tools). Va antes
  del system y se cachea mientras no cambie la lista.
- **Comportamiento**: el modelo puede llamar la herramienta sin texto o el texto sin la
  herramienta. El system pide "texto + herramienta"; se corrige la descripción "Cuándo usarlo"
  sin tocar código.
- **Comprobantes falsos o editados**: el agente confirma lo que ve; por eso el aviso interno
  "cotejar depósito" es obligatorio y el envío físico sigue siendo humano. El agente nunca
  confirma sin imagen.
- **Datos bancarios**: hoy el Goal pide handover; con la imagen se automatiza. Sigue la regla
  del Goal: tras un comprobante no se reenvían (lo decide el agente con el contexto del hilo).

## 7. Plan en pasos chicos

### (a) NO toca `lib/ai/runtime` ni los archivos del agente

| Paso | Entregable | Toca |
|---|---|---|
| A0 | **Spike Zernio media** — HECHO (§0.3) | — |
| A1 | Rebase sobre main; migración (siguiente número libre): `media_assets`, `workflows`, `workflow_steps`, `workflow_runs`, `messages.type` + `system_note`; ACL `workflow` / `mediaAsset`; seed de los 12 predeterminados con textos y palabras clave redactados desde el Goal/FAQs (deshabilitados los que necesitan archivo hasta subirlo) | `lib/db/schema/automation.ts`, `drizzle/00NN_*`, `lib/auth/permissions.ts` |
| A2 | **Biblioteca de media**: PUT firmado, `confirmAsset`, listar, borrar; validación mime/tamaño; tests puros de claves y validación | `lib/storage/s3.ts` (+PUT), `lib/media-library/*` |
| A3 | **Media saliente**: `sendMedia` en `MessagingProvider` + Zernio (`attachmentUrl`) + `sendMediaMessage` en `send.ts` (idempotente, mismo contrato de fallo, ventana 24 h) | `lib/messaging/provider.ts`, `zernio.ts`, `send.ts` |
| A4 | **Ejecutor**: `lib/workflows/executor.ts` + job BullMQ `workflow.run` (pasos secuenciales, cursor, reintento por paso, `ventana_24h`, `internal_note`) + `runWorkflow()` server action | `lib/workflows/*`, `worker/*` |
| A5 | **Pestaña Automatización** (`/automatizacion`): lista, formulario, pasos, selector de biblioteca, "Probar", corridas | `app/(app)/automatizacion/*`, `app/(app)/layout.tsx` |
| A6 | **Disparadores humanos y de cliente**: comandos y sección en el menú "/" del composer; palabras clave del cliente como hook propio en `ingest.ts` (aislado, try/catch, respeta modo del canal); disparo por etapa en `updateContactStage` y en el arrastre del Embudo; nota `system_note` en la bandeja | `lib/inbox/*`, `lib/messaging/ingest.ts`, `lib/actions/contacts.ts` |
| A7 | Gate: revisión adversarial Claude + cyber-neo + `/codex:adversarial-review --base main` (criterio: escenario real o va a la lista); typecheck/test/lint; prueba de `/tabla` y `/banco` en el sandbox | — |

Cada paso es una rebanada vertical desplegable; A5 ya se puede usar (con comandos) sin el agente.

### (b) Enganche con el agente (espera el cierre de la Fase B → rebase sobre main)

| Paso | Entregable | Toca |
|---|---|---|
| B1 | Rebase de `feat/agente-ia-fase-d` sobre main | — |
| B2 | `toolCalls` en `CallModelResult`; tools sin `execute` (una sola vuelta); `strict` | `lib/ai/types.ts`, `providers/*`, `index.ts` |
| B3 | Tools dinámicas desde `workflows` + `cambiar_etapa` + `transferir_humano` + `pago_confirmado` / `pago_no_cuadra`; system: quitar las líneas "todavía no disponible", regla "texto primero, luego herramienta", instrucciones de comprobante (§2.2) | `lib/ai/runtime/brain.ts`, `tools.ts` (nuevo) |
| B4 | `run.ts`: texto → guardia → burbujas → acciones con relectura de estado; borrador = acciones `skipped` | `lib/ai/runtime/run.ts`, `state.ts` |
| B5 | ~~Guardia con montos ya vistos~~ — **descartado** (la Fase B 3 quitó la guardia; módulo eliminado el 24-sep) | — |
| B6 | Contexto "ya enviado en esta conversación" (lee `workflow_runs`) | `lib/ai/runtime/context.ts` |
| B7 | Gate completo + prueba en el sandbox con el dueño (tabla, banco, comprobante que cuadra y que no cuadra) | — |

## 8. Estado de la parte (a) y decisiones de implementación (23-sep-2026)

Construido y con tests (unitarios + integración en Postgres real): migración `0027_automatizacion` (renumerada desde 0025 tras la Fase B 3 y la parte 2 del editor, 24-sep),
ACL `workflow`/`mediaAsset`, 12 predeterminados (`lib/workflows/defaults.ts`), seed idempotente por
slug (hook de creación de organización + botón "Restaurar predeterminados"; **no hay migración de
seed**: la organización que ya existía los recibe con el botón), biblioteca de media
(`lib/media-library/*`, `POST /api/biblioteca/upload` en streaming con tope real por bytes,
`GET /api/biblioteca/[assetId]` → URL firmada de 5 min), media saliente (`sendMedia` en el
proveedor + `sendMediaMessage`, URL firmada de 15 min, outbox e idempotencia iguales que el
texto), ejecutor (`lib/workflows/executor.ts`, cola `workflow-runs`, `worker/workflows.ts`),
disparadores (`lib/workflows/triggers.ts`), server actions, pestaña `/automatizacion` y comandos
en el composer.

Decisiones que no estaban en el diseño original:
- **Predeterminados nacen apagados.** Solo se pueden habilitar cuando todos sus pasos de archivo
  tienen media elegida (el editor y `toggleWorkflow` lo exigen). Un archivo borrado de la
  biblioteca vuelve a dejar el workflow en "falta archivo".
- **Palabra clave del cliente: dispara UN workflow por mensaje** (la coincidencia más larga; `position`
  desempata) para no inundar; solo mensajes de texto, nunca imágenes. **Igual que GHL (24-sep):** coincidencia
  "contiene", sin mayúsculas ni acentos, sin tope de palabras; por palabra clave cada workflow se manda **una
  sola vez por contacto** (`contacts.keyword_workflows_sent`, migración 0028; invisible al vendedor); por
  comando del vendedor y por petición del agente se manda siempre. Textos y palabras clave de los
  predeterminados copiados de la auditoría de GHL; "Cliente entrante inbox", "Leads redes sociales" y "Cambio
  de etapa cliente" no se replican (el CRM ya crea el contacto en Inbox y la etapa la mueve el agente).
  **Pie del adjunto (24-sep):** como en GHL, el texto de cada paso de imagen/video va como pie del archivo
  (un solo mensaje de WhatsApp); solo los pasos de texto puro van aparte. Fuente: referencia de Zernio
  `POST /v1/inbox/conversations/{id}/messages` (`message` + `attachmentUrl` en la misma petición) y el
  spike del §0.3 (imagen + `message` → un solo `wamid`).
- **`set_stage` dentro de un workflow NO dispara** los workflows "al entrar a la etapa" (evita
  cadenas y bucles). El disparo por etapa solo ocurre por acción humana (`updateContactStage`),
  y solo si la etapa realmente cambió.
- **Modo del canal:** un disparo del agente o por palabra clave con el canal fuera de `auto`
  queda `skipped` con motivo `canal_apagado` (el modo borrador ya no existe). Los comandos del
  vendedor y los disparos por etapa manual corren siempre. **Solo el comando sale como `crm`** (y pausa al
  agente de inmediato, como un envío manual); una etapa arrastrada sale como `ai_agent`: lo que manda un
  workflow cuenta como del agente, no pausa al agente ni apaga el semáforo (24-sep-2026).
- **Corridas del agente** (`source: ai_agent`) releen el estado antes de cada envío al cliente:
  si un vendedor escribió después de crearse la corrida, o el canal salió de auto, se cancela con
  motivo (`respuesta_humana`, `cambio_de_modo`, `agente_pausado`).
- **Reintentos:** el ejecutor avanza `step_cursor` después de cada paso; un reintento de BullMQ
  retoma donde quedó. Un rechazo del proveedor deja la corrida `failed` con el código y no se
  reintenta sola (igual que un envío manual). El barrido re-encola `queued` > 30 s sin job y da por
  fallidas las `running` > 10 min.
- **Aviso interno** = fila en `messages` con `type: system_note`, `status: sent`, sin wamid: la
  bandeja la pinta centrada en ámbar y nunca pasa por el proveedor.
- **Reordenar** en la lista es con flechas ↑↓ (no arrastre) en v1.
- Los comandos del vendedor aparecen en el menú "/" del composer como sección "Automatizaciones";
  un texto que sea exactamente `/algo` y corresponda a un workflow lo dispara en vez de enviarse.
- El limitador de tasa y las colas nunca bloquean la pestaña: sin Redis, encolar falla y el
  barrido del worker recoge la corrida.

Pendiente para cerrar la parte (a): gate (§7 A7) y prueba de `/tabla` y `/banco` en staging con
el sandbox, con archivos de prueba hasta que el dueño entregue los reales (§5).

### 8.1 Gate de la parte (a) — 23-sep-2026 (revisión adversarial de Claude + cyber-neo + Codex)

Corregido de inmediato (escenario real):
- ~~Palabras clave demasiado agresivas en AUTO~~ — sustituido el 24-sep por la paridad con GHL: palabras
  clave exactas de GHL, coincidencia "contiene" sin tope de palabras y una vez por contacto.
- ~~Carrera de "una vez por conversación"~~ — regla eliminada el 24-sep (definición 7); la
  exclusividad por conversación del ejecutor evita que dos corridas se intercalen.
- **Fallo silencioso al arrastrar una tarjeta** (ventana cerrada: el vendedor cree que el cliente ya
  tiene la CLABE): una corrida disparada por humano que falla deja un **aviso interno en el hilo**.
- **Marcado de leídos indebido**: los envíos por etapa/agente/palabra clave ya **no marcan leídos**
  (`markRead` explícito; solo el comando del vendedor, que está viendo el chat).
- **Aviso de pago sin visibilidad**: el aviso interno **sube la conversación y la marca no leída**; en
  `pago_confirmado` va antes de la etapa "Compra".
- **"Probar"** ya no obliga a habilitar el workflow (no queda expuesto a clientes reales antes de
  verlo), no preselecciona conversación y muestra canal + teléfono.
- **Enter en el composer** ejecuta un comando solo con coincidencia **exacta** ("/t" + Enter no manda nada).
- **Eco antes del enlace**: la burbuja del archivo enviado conserva el adjunto de la biblioteca (no
  queda "procesando" y el vendedor no lo reenvía).
- **Variables**: el editor rechaza variables desconocidas y una sin valor se quita antes de enviar.
- **Argumentos de herramienta** nunca pisan `{{nombre}}`/`{{vendedor}}`; la etapa del argumento solo
  la toma `cambiar_etapa`.
- Encabezados de subida malformados → 400; errores crudos de BD ya no llegan a la pantalla;
  concurrencia 3 del worker y espera máxima de 10 s por paso.

Para la **parte (b)** (tocan `lib/ai/runtime`, prohibido hasta el cierre de la Fase B):
- **PRIMERO (24-sep-2026, paridad con GHL): la corrida por palabra clave hace que el agente NO responda lo
  demás del mensaje.** La corrida sale en segundos como `ai_agent`; el job del agente (debounce) encuentra
  0 pendientes (`pendingInbound` = entrantes posteriores al último saliente) y calla. En GHL el workflow
  manda la media y Ángela contesta el mismo mensaje con normalidad: hay que corregirlo para que **ambos**
  salgan (p. ej. `pendingInbound` ignora los salientes cuyo id esté en `workflow_runs.message_ids` de
  corridas `keyword`, o el ejecutor no cierra el pendiente). Los workflows NUNCA pausan al agente.
- Excluir `type = system_note` de `lastOutbound` / `humanOutboundCount` / `recentMessages`
  (`context.ts`, `run.ts`, `transcript.ts`): hoy una nota contaría como "respuesta humana" (pausa
  indefinida) y entraría al transcript del modelo como frase propia.
- Con el canal en AUTO, el gancho de palabra clave debe **ceder al agente** (que tiene las tools):
  si no, cliente recibe dos respuestas al mismo "tabla".
- Solo los envíos por comando cuentan como respuesta humana (`first_response_seconds`); los de etapa ya no (24-sep).

**Revisión de Codex (14 hallazgos), corregido con escenario real:** `workflow_runs.once` para que el
índice único no bloquee workflows repetibles; un envío **sin confirmar** (timeout) detiene la corrida,
no mueve la etapa y avisa al vendedor (`envio_sin_confirmar`); una corrida `running` con **lease
vencido (2 min)** se retoma por cursor tras un reinicio del worker (máx. 3 intentos); **exclusividad por
conversación** (dos corridas no se intercalan: `busy` → reintento); al reclamar se **revalida**
habilitado y archivos; el agente relee el estado antes de **cada** paso (apagar el canal frena también
etapa/etiqueta/pausa); `set_stage` **no pisa** una etapa que un humano movió después de crearse la
corrida; **anticipo del 50 %** tiene workflow propio (`anticipo_confirmado` → cerca_compra); la palabra
clave más larga gana entre **todos** los workflows; `system_note` fuera del semáforo y de la primera
respuesta (`lib/inbox/queries.ts`, `ingest.ts`); videos **HEVC** (iPhone) rechazados al subir.

Sin escenario (lista, no frena): fallos transitorios de BD en los disparadores no se reintentan (solo
log); carrera guardar-workflow vs borrar-archivo entre dos pestañas; el borrado lógico no purga el
bucket (retención pendiente); borrar un workflow cascadea sus corridas; editar pasos con una
corrida a medias mueve el cursor; sin token CSRF en la ruta de subida (los headers X-* fuerzan
preflight); varios workflows con la misma etapa disparan en cadena sin tope; sin sniffing de
contenido en la subida (un MIME falso falla después en el proveedor, visible en la corrida).

### 8.2 Gate del delta contra `main` — 24-sep-2026 (tras el rebase sobre la Fase B 3)

Corregido de inmediato (escenario real):
- **Arrastrar una tarjeta pausaba al agente y apagaba el semáforo**: los envíos por etapa salían como
  `crm` con el vendedor como autor → el runtime los leía como "un vendedor tomó el hilo" (pausa hasta
  "Reactivar"), la bandeja daba por contestada la última pregunta del cliente y contaba como primera
  respuesta. Ahora **solo el comando** sale como `crm`; etapa/agente/palabra clave salen como `ai_agent`.
- **El comando del vendedor no pausaba al agente de inmediato** (solo "de rebote" en el siguiente entrante
  y solo si su mensaje quedaba como último saliente): `runWorkflowCommand`/"Probar" llaman
  `pauseAgentForManualSend` al encolar.
- **Dos corridas de la misma conversación se reclamaban a la vez** (READ COMMITTED: cada UPDATE veía a la
  otra aún `queued`) e intercalaban texto/imagen de A y B al cliente: candado consultivo por conversación
  (`pg_advisory_xact_lock`) en la transacción del reclamo.
- **Paso "pasar a humano"** tras la Fase B 3 (ya no existen `addContactTag`, `TAG_HANDOVER` ni la pausa
  de 8 h): desde un comando/"Probar" → `pausado_humano` hasta "Reactivar"; desde el agente → solo aviso
  en el hilo; sin etiqueta por defecto.
- **Comprobante sin regla de fecha**; ~~cuenta/tarjeta enmascarada~~ (Datos de cobro eliminado el 24-sep);
  el aviso interno de un comando no marca no leído al vendedor que lo pidió.

Revisión de Codex (16 hallazgos "A"; corregido lo que duplica mensajes o confirma un pago que no cuadra):
- **Reenvío si el worker muere entre el 2xx del proveedor y el avance del cursor**: id de mensaje
  DETERMINISTA por (corrida, paso) (`stepMessageId`); el reintento encuentra la fila y no reenvía (test).
- **Lease sin renovar**: una corrida larga (esperas + envíos lentos) podía ser reclamada por otro worker
  estando viva; ahora `started_at` se renueva en cada paso.
- **Referencia del comprobante**: `ABC-123`, `abc 123` y `ABC123` eran referencias distintas para el índice
  único (mismo comprobante confirmando dos pedidos); ahora se normaliza a alfanumérico en mayúsculas.
- **Moneda**: "USD 5,500" cuadraba contra MXN 5,500; con moneda distinta de MXN pasa a humano.
- ~~Destinatario~~ (cotejo eliminado el 24-sep): los últimos 4 dígitos solo valían con máscara y el beneficiario se comparaba por
  palabras completas ("Ana López" ya no coincide con "Mariana López").
- **Tolerancia** de $1 → un centavo ($5,499 contra $5,500 ya no cuadra).
- Descripciones de las herramientas: "no la repitas" → "vuelve a mandarla solo si el cliente la pide otra vez".
- No se acepta: quitar `add_tag`/`addContactTag` (la Fase B retiró las etiquetas *internas del agente*; la
  etiqueta "cotejar depósito" del workflow de pago es un paso configurado por el admin, no una regresión).

Para la **parte (b)** (tocan `lib/ai/runtime`):
- `system_note` sigue entrando a `lastOutbound`/`humanOutboundCount`/`pendingInbound` y al transcript del
  modelo como turno propio (`context.ts`, `transcript.ts`): una nota de un comando (`crm`) cuenta como
  saliente humano (hoy coincide con la regla: el comando pausa) y, tras "Reactivar", el modelo ve "No se
  envió «Datos bancarios»…" o "Pago reportado… Cotejar" como frase suya y puede repetir esa jerga al
  cliente. Excluir el tipo en esas consultas.
- Palabra clave en AUTO: la corrida sale en segundos como `ai_agent`, así que el job del agente encuentra
  0 pendientes y **no contesta lo demás** del mismo mensaje ("me pasas la tabla y el precio?" → solo la
  tabla). Los predeterminados nacen sin palabras clave; si se activan, `pendingInbound` debe ignorar los
  salientes de corridas `keyword` o el gancho debe ceder al agente.

Sin escenario (lista, no frena): tras una caída del
worker la corrida `running` espera el lease de 2 min (BullMQ reentrega a los ~30 s pero el reclamo la rechaza);
`envio_sin_confirmar` corta la corrida aunque el mensaje se concilie después (la etapa no se mueve; queda aviso
solo en comando/etapa); sin tope de repetición por palabra clave (definición 7: el agente decide; si se activan
palabras clave, valorar un tope de 10 min por workflow y conversación); `verificarComprobante` sin moneda
("USD 300" se compara contra MXN) y "12.345" se lee como 12 345; reintento del mismo comprobante tras un fallo
parcial lanza `ReferenciaDuplicadaError` (devolver el pago existente si coincide la conversación); últimos 4
dígitos del destinatario coinciden con cualquier número corto que termine igual; MIME de la subida confiado del
header (solo HEVC se detecta; un archivo malo falla al enviar y queda visible en la corrida); sin cuota por
organización ni rate limit en la subida (solo owner/admin); borrar un workflow cascadea sus corridas (perder
traza de `message_ids`; valorar borrado lógico); "Probar" ejecuta pasos reales sobre un contacto real (usar
uno de prueba); `/api/biblioteca/[assetId]` sin `Cache-Control: private`; filas `skipped` por cada palabra
clave con el canal apagado; `ALTER TYPE … ADD VALUE` de la 0027 requiere PG ≥ 12 (Railway cumple); un fallo
transitorio de BD en los disparadores se absorbe (la palabra clave no se reevalúa; en etapa el vendedor no ve aviso);
editar/reordenar pasos con una corrida a medias mueve el cursor (guardar snapshot de pasos en la corrida); las
consultas internas del ejecutor filtran por id de corrida sin `organization_id` (ids únicos; no explotable);
`pagos.ts` recibe conversación/contacto/organización por separado (validar en la parte b).

### 8.3 Gate de la parte (b) — 24-sep-2026 (adversarial de Claude + cyber-neo + Codex)

Corregido de inmediato (escenario real):
- **Inyección de cotización**: el cliente podía dictarle al modelo un total bajo y "cuadrar" un
  comprobante barato (misma vuelta o dos mensajes). Ahora `fijar_cotizacion` se ignora si viene con un
  comprobante, solo se acepta un total que el agente le está diciendo al cliente en su propio texto, no
  hay respaldo de cotización en memoria, y un pago confirmado contra una cotización del agente deja un
  aviso extra al vendedor ("cotejar el monto"). Un total fijado a mano por un vendedor no se pisa.
- **"Pago confirmado" antes de registrar**: el pago se registra y su corrida (aviso + etapa) se encola
  ANTES de mandar el texto; si la referencia entró dos veces a la vez o la BD falla, sale el texto
  amable y corre `pago_no_cuadra`. Si el envío se detiene tras ≥1 burbuja, las acciones corren igual.
- **Compra solo con pago**: `cambiar_etapa {compra}` se ignora; una corrida del agente nunca retrocede
  etapas (comprobado en SQL); si el comprobante no cuadra, ninguna `cambiar_etapa` de esa vuelta corre.
- **Silencio del agente**: la media de una corrida del AGENTE (espera de 30 s de la tabla) cerraba los
  pendientes y lo que el cliente escribía mientras tanto quedaba sin respuesta; el id del mensaje se
  anota en la corrida ANTES de mandarlo (ventana de 1 s); solo llamadas sin texto ya no lanza (cada
  reintento era otra llamada pagada) y, si ninguna acción manda nada, sale un texto de respaldo del CRM.
- **Comprobante**: sin foto reciente (desde el último pago, tope 24 h) se pide la foto en vez de mandar
  el "pago recibido" del modelo; la misma referencia reenviada en la MISMA conversación responde "ya lo
  tenemos registrado" sin acusar; un anticipo cuyo workflow está deshabilitado no se registra; argumento
  `moneda`; igualdad exacta en centavos; motivos internos traducidos para el cliente.
- **Doble tabla**: palabra clave + herramienta del mismo workflow para el mismo mensaje → la del agente
  no se repite. Barrido: avisos y media de corridas fuera de las burbujas de un plan; correlación por
  organización en las subconsultas.

Sin escenario (lista, no frena): confirmación falsa SOLO por texto (el modelo escribe "pago confirmado"
sin llamar la herramienta: no hay gate determinista sobre el texto; el aviso "cotejar" no existe en ese
caso); uso/costo se persiste al final (una caída entre la llamada y el registro pierde la fila);
`cambiar_etapa` hacia atrás por el vendedor sigue permitido; corridas del agente sin tope de repetición
(las de palabra clave sí: una por contacto); el modelo puede pedir media a voluntad (costo por mensaje);
`InvalidToolInputError` del SDK no lanza (AI SDK 7 marca `invalid` y el runtime lo ignora); humano que mueve
la etapa durante la generación (ahora se usa el `now` de la ronda); descripciones de herramientas son
solo texto para el modelo.

## 9. Plan de salida a producción (parte a)

Reglas del dueño: **nada va a staging ni al sandbox hasta su aviso**; el modo "borrador" **ya no
existe en el negocio**: para palabras clave del cliente y disparos del agente, cualquier valor del
canal distinto de `auto` cuenta como apagado; los comandos del vendedor siempre salen (salvo
workflow deshabilitado).

1. **Fase B entra a `main`** (otro chat). Pre-chequeo del 23-sep: la rama de la Fase D no comparte
   archivos con `origin/fix/agente-ia-auto`, `-8` ni `staging`; el ensayo de merge es limpio y
   ninguna agrega migración (la 0025 sigue libre).
2. **Rebase** de `feat/agente-ia-fase-d` sobre `main`; si `main` trae una migración nueva, la 0025
   se regenera con el siguiente número libre (no está aplicada en ningún entorno).
3. **Gate solo del delta**: revisión adversarial de Claude + cyber-neo + `/codex:adversarial-review
   --base main`, con `npm run typecheck`, `npm test` (BD propia) y `npm run lint`. Sin `npx`.
4. **`main` con los workflows apagados** (nacen así). La migración 0027 corre sola en `start:web`;
   verificar `/api/health/inbound` y que el worker loguee `[workflows]`.
5. En producción, pestaña Automatización: "Restaurar predeterminados" (14, apagados); **subir los 6
   archivos de `listos/`** desde Biblioteca; asignarlos en cada workflow; **habilitar solo los
   completos** (`tabla_tamanos_estandar`, `datos_bancarios`, `video_instalacion_estandar`,
   `video_instalacion_medida`, `video_instalacion_mini`, `tapones_inflables` (solo video desde el 24-sep),
   `transferir_humano`, `cambiar_etapa`). `donde_medir`, `tabla_tamanos_mini` y `medidas_especiales`
   quedan apagados con "falta archivo" (los archivos se agregan después desde el editor). Un comprobante se
   confirma con monto + referencia no repetida; **sin regla de fecha ni de destinatario** (24-sep).
6. **Prueba en producción, solo `ch_zernio_sandbox`** (teléfono del dueño): `/tabla`, `/banco` y
   una palabra clave del cliente (con el canal en `auto`). Verificar burbuja con adjunto,
   `workflow_runs` `done`, etapa → Cerca de compra, y que un segundo `/banco` repita a propósito
   mientras el agente no.
7. **Parte (b)**: enganche al agente (tools) y comprobantes (`lib/cobro/comprobante` +
   `pagos.ts`), con su propio gate y prueba en `ch_zernio_sandbox` en `auto`.
8. **Vuelta atrás:** deshabilitar todo desde la pestaña detiene la Fase D sin deploy; la 0027 solo
   agrega tablas y un valor de enum.

## 10. Parte (b) REESTRUCTURADA — el Agente IA decide solo; Automatización = solo envíos de media (24-sep-2026)

Rama `feat/agente-ia-fase-d-b`. **Migración `0031_agente_decide_solo`** (la 0029 está en `main`; la
**0030 queda reservada para Anuncios de Meta**, que deberá renumerar su `0028_anuncios_meta`). Contratos
intactos para el indicador del agente de Pulido UI: `jobId = conversationId` en la cola
`agent-replies` y las columnas `workflow_runs.trigger` / `workflow_runs.status`.

### 10.1 Qué se quitó y qué quedó

- **Fuera de Automatización:** "Pago confirmado", "Anticipo confirmado", "Comprobante que no cuadra",
  "Pasar a humano" (`/humano`) y "Cambiar etapa". "Restaurar predeterminados" no los vuelve a crear.
  El editor de pasos queda con **texto, archivo (imagen/video/documento, con pie) y espera**.
- **Quedan los 9 de media** sin cambios en contenido ni disparadores: tabla estándar, tabla mini,
  datos bancarios, video estándar, video a la medida, video mini, tapones, dónde medir, medidas
  especiales. `/tabla` y `/banco` siguen igual (pausan al agente por ser comandos del vendedor).
- **`/banco` → Cerca de compra** sigue, pero como regla interna del CRM al terminar la corrida de
  `datos_bancarios` (cualquier disparador), con la misma lógica de `mover_etapa` (solo hacia adelante).
- **Se borró `verificarComprobante`** y todo código que decidía por monto. El agente decide solo, con
  su Goal y su lectura de la imagen o el PDF.
- **Tablas:** `pagos_confirmados` y su enum se borran; queda el registro mínimo **`comprobantes`**
  (contacto, conversación, mensaje del comprobante, monto, referencia, banco, fecha del comprobante,
  tipo `total | anticipo | resto`, fecha de creación; único por mensaje). Columna nueva
  `contacts.stage_changed_by` (`vendedor | agente | sistema`). No se tocan mensajes ni avisos.
- **Conteos de producción que borra la 0031** (leídos el 24-sep): 5 workflows (`transferir_humano`,
  `cambiar_etapa`, `pago_confirmado`, `anticipo_confirmado`, `pago_no_cuadra`), sus 10 pasos, el paso
  `set_stage` de `datos_bancarios` (1), 0 corridas de esos workflows, 0 filas de `pagos_confirmados`.
  Quedan 9 workflows con 11 pasos y las 7 corridas de los de media.

### 10.2 Acciones internas del agente (invisibles para el cliente)

Salen en la **misma llamada** que genera cada respuesta (tool-calling, sin llamada extra). Se
conservan `fijar_cotizacion` y las `wf_<slug>` de los 9 workflows de media.

- **`mover_etapa(etapa)`** — Inbox → Prospecto → Interesado → Cerca de compra → Compra. Solo hacia
  adelante; hacia atrás o a la misma etapa se ignora sin error. La etapa puesta a mano por un vendedor
  manda (el agente nunca la regresa; solo la avanza por algo nuevo del chat). Queda registrada como
  cambio del Agente IA (`stage_changed_by = agente`) y dispara lo mismo que hoy dispara un cambio de
  etapa (workflows "al entrar a esta etapa"). La etapa es el dato del que la parte (c) sacará el
  modelo (Luna / Sonnet 5); la parte (c) no se construye ahora.
- **`aviso_vendedor(motivo, detalle, …)`** — motivos `cotejar_deposito | cliente_pide_humano |
  comprobante_dudoso`. Se muestra como el aviso 🤖 de hoy en la Bandeja y el pop-up del Embudo; nunca
  le llega al cliente; **no pausa al agente**. Con `cotejar_deposito` y `comprobante_dudoso` el agente
  manda lo que leyó (monto, referencia, banco, fecha, tipo) y eso se guarda en `comprobantes`. Si el
  agente mueve a Compra (o a Cerca de compra con un comprobante en el lote) sin mandar
  `cotejar_deposito` en esa misma respuesta, el CRM crea el aviso "Cotejar depósito" igual.
- **Idempotencia por lote** (el bug de reintentos de `fix/agente-reenvio` sigue abierto): avisos
  únicos por (mensaje del lote, motivo); comprobante único por mensaje del comprobante; etapa solo
  hacia adelante; corridas de media ya idempotentes por paso.
- **`[TRANSFERIR]`** de Goals viejos se quita del texto y cuenta como `aviso_vendedor(cliente_pide_humano)`.
  El runtime no tiene reglas de negocio propias: las reglas viven en el Goal.
- **Orden dentro de la respuesta:** avisos (y registro del comprobante) **antes** del texto (el
  vendedor los ve aunque el envío falle); etapa, cotización y media **después** del texto. Si el
  modelo solo devolvió acciones y ninguna manda nada al cliente, sale un texto de respaldo del CRM.

### 10.3 Chequeo silencioso de referencia repetida

Con un comprobante con referencia, el CRM busca esa referencia (normalizada) en la organización.
Mismo contacto (reenvió la misma foto): no es repetida; no se registra dos veces ni sale aviso nuevo.
Otro contacto, o un pago anterior distinto: el aviso al vendedor termina con "⚠ Referencia ya usada con
[nombre del contacto] el [fecha]. Cotejar antes de entregar", llenado por el CRM. No frena al agente,
no cambia lo que le dice al cliente ni bloquea la etapa.

### 10.4 Lo que el agente recibe en su contexto

Al final del último turno del cliente (no en el system, para no romper la caché del prompt): etapa
actual y si la puso un vendedor; monto de cotización guardado (el del vendedor manda sobre
`fijar_cotizacion`); comprobantes ya registrados del contacto (monto, tipo, fecha). Las **imágenes y
los PDF** del cliente llegan al modelo como archivo (URL firmada; hasta 20 imágenes y 3 PDF, los más
recientes). Costo aproximado de un comprobante SPEI en PDF de una página con Sonnet 5: ~2,000–3,000
tokens de entrada (≈ $0.01 USD por llamada); una imagen, ~1,500 tokens.

### 10.5 Texto para el Goal (el dueño lo pega a mano en la pestaña Agente IA)

Bloque completo para pegar al final del Goal (sustituye a las secciones "TRANSFERENCIA A HUMANO" y
complementa "COMPROBANTE DE PAGO"):

```
ETAPAS DEL EMBUDO

Avanza al cliente de etapa con la acción mover_etapa según lo que pase en el chat. Solo se avanza, nunca se regresa; si un vendedor movió la etapa a mano, respétala.

- Cuando el cliente contesta por primera vez: Prospecto.
- Cuando pregunta precio o da medidas: Interesado.
- Cuando recibe los datos bancarios, o cuando confirmas un anticipo del 50 % de una compuerta a la medida: Cerca de compra.
- Cuando confirmas un comprobante válido por el total (o por el resto que faltaba): Compra.

Cada vez que le digas un total al cliente, guárdalo con fijar_cotizacion.

COMPROBANTES DE PAGO

Cuando el cliente mande una imagen o un PDF de pago, revisa que sea un comprobante real de dinero (transferencia, depósito o pago con link) y que el monto sea exacto: el total cotizado, el anticipo del 50 % de una compuerta a la medida ($3,500 de $7,000) o el resto pendiente. Usa el contexto del CRM para saber qué lleva pagado y cuál es el total guardado.

Si cuadra: confírmalo al cliente, mueve la etapa (Compra si es el total o el resto; Cerca de compra si es anticipo) y avisa al vendedor con aviso_vendedor motivo cotejar_deposito, con monto, referencia, banco, fecha y tipo (total, anticipo o resto).

Si no cuadra, no se lee bien o se ve dudoso: díselo al cliente con amabilidad, sin acusarlo, y avisa al vendedor con aviso_vendedor motivo comprobante_dudoso con lo que alcanzaste a leer. En ambos casos sigue atendiendo al cliente con normalidad.

Nunca confirmes un pago solo porque el cliente diga que ya pagó: necesitas ver el comprobante.

PASAR A HUMANO

Avisa al vendedor con aviso_vendedor motivo cliente_pide_humano únicamente cuando el cliente pida expresamente hablar con una persona. Dile que un asesor lo atenderá y sigue atendiéndolo tú mientras tanto; no dejes de responder.
```

Frases del Goal actual que contradicen esto y su reemplazo exacto:

1. Actual: `Si solicita explícitamente un enlace para pagar con tarjeta, activa "Transferencia a humano".`
   ```
   Si solicita un enlace para pagar con tarjeta, dile que un asesor se lo envía en un momento y avisa al vendedor con aviso_vendedor motivo cliente_pide_humano. Sigue atendiendo sus demás dudas.
   ```
2. Actual: la sección `TRANSFERENCIA A HUMANO` completa (las 8 viñetas y "Cuando transfieras, deja de preguntar y responder.").
   ```
   (Borrar la sección completa; la sustituye "PASAR A HUMANO" del bloque nuevo.)
   ```
3. Actual: `Si el cliente menciona fraude, estafa, engaño o continúa con insultos, amenazas o comportamiento agresivo persistente, transferir a humano.`
   ```
   Si el cliente menciona fraude, estafa o engaño, o continúa con insultos o amenazas, responde con calma una sola vez, avisa al vendedor con aviso_vendedor motivo cliente_pide_humano y sigue atendiendo sin discutir.
   ```
4. Actual: `Si un cliente reporta un problema con el producto, solicita devolución, cancelación o expresa inconformidad con su compra, solicitar una explicación breve y fotografía si corresponde, después escalar a humano.`
   ```
   Si un cliente reporta un problema con el producto, solicita devolución, cancelación o expresa inconformidad con su compra, pide una explicación breve y fotografía si corresponde, avisa al vendedor con aviso_vendedor motivo cliente_pide_humano y sigue atendiendo. No prometas cancelaciones, devoluciones ni reembolsos.
   ```
5. Actual (sección COMPROBANTE DE PAGO): `Al recibir el comprobante, confirma la recepción y solicita los datos de envío en un solo mensaje:`
   ```
   Al recibir un comprobante que cuadra, confirma la recepción, mueve la etapa y avisa al vendedor (bloque COMPROBANTES DE PAGO), y solicita los datos de envío en un solo mensaje:
   ```
6. Actual: `No actives Transferencia a Humano durante este proceso.`
   ```
   Durante este proceso no avises al vendedor con cliente_pide_humano salvo que el cliente lo pida expresamente.
   ```

### 10.6 Tests (Vitest) que lo cubren

`lib/contacts/stage.test.ts` (orden y solo adelante), `lib/ai/runtime/tools.test.ts` (herramientas
ofrecidas y validación), `lib/ai/runtime/run.int.test.ts` (mover_etapa adelante/atrás/igual y etapa
del vendedor; aviso_vendedor sin pausa y sin llegar al cliente; Compra siempre con cotejar; idempotencia
con reintento; referencia repetida mismo contacto vs otro; contexto con etapa, cotización y
comprobantes; PDF al modelo; B0), `lib/workflows/executor.int.test.ts` (`/banco` → Cerca de compra
solo hacia adelante; predeterminados solo de envío), `lib/workflows/defaults.test.ts` +
`seed.int.test.ts` (los quitados no se recrean), `lib/db/migrations-journal.test.ts` (0031 con la
0030 reservada). La migración se probó sobre datos como los de producción (14 workflows, pasos de
todos los tipos, corridas y un pago): 14 → 9 workflows, 14 → 5 pasos, 3 → 2 corridas, mensajes y
avisos intactos.
