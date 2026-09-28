# Go-live del número real de WhatsApp (Zernio, coexistencia)

Checklist para conectar el número real (+52 668 241 9579) a **producción**. Si la
cuenta del número no está en `ZERNIO_ALLOWED_ACCOUNT_IDS`, sus mensajes llegan al
webhook, se contestan con 200 y quedan **en cuarentena** (`webhook_events.quarantined_at`):
no se pierden, pero tampoco aparecen en la Bandeja hasta liberarlos. Cada uno deja un
`console.warn` con `account_id` y tipo, y el worker avisa cada minuto
(`[worker] CUARENTENA: …`). Liberarlos tras corregir la allowlist y el canal:
`npx tsx scripts/replay-webhook-events.ts` (la cuarentena caduca a los 30 días).

Todo se valida primero en `staging` (CLAUDE.md §4). Los secretos los pega el dueño
por portapapeles; nunca en el chat.

## Día del número oficial — guion (en orden)

**YO** = el dueño (celular, Meta, Zernio). **CODE** = Claude Code (comandos). Cada paso
de CODE muestra el resultado antes de seguir; nada de producción se escribe sin el OK
del paso. Comandos desde el worktree con la base de producción por el proxy público y la
llave de Zernio del servicio `crm-diluvium` (nunca se imprimen); `$PROD` = el prefijo de
docs/numero-prueba.md › "Después del QR".

> Por qué el orden importa: Meta entrega la copia del historial **una sola vez** y hay
> **24 h** para aceptarla en el celular. Zernio la guarda; el CRM la jala después con calma.

### A. Antes (la víspera o esa mañana)

1. **CODE** — Respaldo: `gh workflow run db-backup.yml --ref main` y esperar verde
   (`gh run watch`). Anotar el número de corrida.
2. **CODE** — Confirmar que N1 (sandbox) está archivado y fuera de la lista:
   `select id, is_test, is_active, archived_at, ai_agent_mode from channels;` y
   `ZERNIO_ALLOWED_ACCOUNT_IDS` de `crm-diluvium` (production) = solo N2
   (`6ab6d4483eb3cfc2601c3902`).
3. **CODE** — Cuentas conectadas en Zernio (`GET /v1/accounts`): hoy 1 (N2). Con el
   oficial serán **2 = gratis**. Nunca 3 a la vez ($6 USD/mes cada una desde la 3.ª).
4. **YO** — Meta Business Suite → portafolio **Grupo Diluvium** → Configuración →
   Pagos → WhatsApp: revisar si la WABA tiene **método de pago**. Sin él, las plantillas
   no salen (desde el 1-oct-2026 Meta cobra también dentro de la ventana de 24 h).
5. **CODE** — Conteos "antes" (se guardan para comparar):
   `select source, count(*) from contacts group by 1;` (hoy 10,901 `ghl_import` + 1
   `whatsapp`), `select count(*) from conversations;`, `select count(*) from messages;`.
6. **YO** — El celular del oficial a la mano, con batería y buena señal, **WhatsApp
   Business actualizada** (2.24.17 o mayor) y abierta. Nadie más lo usa durante la conexión.

### B. Conexión

7. **YO** — En el celular del oficial: WhatsApp Business → Ajustes → **Dispositivos
   vinculados** → tocar la sesión de **goghl** (GHL) → **Cerrar sesión**. Desde aquí GHL
   deja de mandar; lo que mandó ya viene en la copia del celular (no se importa nada de GHL).
8. **YO** — zernio.com → perfil **Default** (NO "Diluvium Pruebas") → Connections →
   WhatsApp → **+ Connect** → **Use my own number** → entra con Facebook →
   **Connect existing WhatsApp Business app account** → portafolio **Grupo Diluvium** →
   número **+52 668 241 9579** → aparece un **QR**.
9. **YO** — Escanear el QR con el celular del oficial (ícono de cámara arriba a la derecha,
   o Ajustes → Dispositivos vinculados) y, **en ese momento, ACEPTAR compartir el historial
   de chats y los contactos**. Volver al navegador, confirmar, y escribirle a Code **QR HECHO**.
10. **CODE** — `GET /v1/accounts`: `accountId` del oficial y su hora de conexión.
    Confirmar 2 cuentas conectadas (N2 y el oficial).
11. **CODE** — Fila del canal ANTES de permitir la cuenta (así no hay hueco):
    `$PROD npm run canal:oficial -- --cuenta <oficial> --conectado <hora ISO>` (simula) →
    `… --confirmar`. Canal real (sin marca Prueba), activo, agente **apagado**.
12. **CODE** — `ZERNIO_ALLOWED_ACCOUNT_IDS` de `crm-diluvium` (production): agregar el
    oficial conservando N2 (mostrar antes y después). Solo la leen el webhook y el replay.
13. **CODE** — Webhook: `GET /v1/webhooks/settings` → activo, `failureCount: 0`, sin filtro de
    cuentas (o que incluya al oficial); `POST /v1/webhooks/test` → 200. Luego
    `$PROD npm run webhooks:replay` (libera lo que llegó del oficial antes de permitirlo).

### C. Historial del celular (corre en SEGUNDO PLANO)

> Desde que el número queda conectado (paso 13), **el bot y los vendedores trabajan normal
> con los mensajes nuevos**. La importación solo va agregando el historial viejo poco a
> poco (unos 43 min para ~1,200 chats); nada de lo importado dispara al bot, ni suma no
> leídos, ni abre la ventana de 24 h, ni cuenta en el Dashboard. La Bandeja y el Embudo se
> ponen al día solos cada 5 s (una señal por lote, no una por mensaje).

14. **CODE** — Reporte previo de una **MUESTRA**, SOLO lectura (no escribe nada):
    `$PROD npm run historial:importar -- --cuenta <oficial> --simular --muestra 50`.
    Revisa solo los **50 chats más recientes** y da el mismo reporte de 10 líneas (chats y
    mensajes, cuántos se pegan a contactos de GHL, contactos nuevos, teléfonos que no se
    pudieron normalizar, posibles duplicados, rango de fechas, adjuntos, agenda y la duración
    estimada de la importación COMPLETA). Tarda **2 a 4 min** según qué tan largos sean esos
    chats (≈ 1 petición a Zernio cada 1.5 s). Code te lo pasa en 10 líneas.
15. **YO** — Revisar el reporte; abrir 2 o 3 de esos chats en el celular y cotejar fechas y
    últimos mensajes. Si todo cuadra, escribir **OK IMPORTAR**. (Si hay "ambiguos" —un
    teléfono con dos contactos— esos chats NO se importan; se revisan a mano después.)
16. **CODE** — Conteos "antes" → arranca la importación **completa en segundo plano**:
    `$PROD npm run historial:importar -- --cuenta <oficial>`. Code la corre en una pestaña de
    la **Terminal del app, a la vista**, con la línea de avance:

    `[historial] chat 350 de 1,200 · 14,210 mensajes nuevos · faltan ~29 min`

    La última línea también queda en `.historial/<oficial>.avance.txt` (con la hora de
    Mazatlán) y Code te la pasa cuando la pidas. Si se corta (Ctrl+C, red, límite de
    Zernio): **el mismo comando sigue donde se quedó**. Va a 40 peticiones/min y cede
    cuando el bot o los vendedores usan el límite de Zernio (deja ~20/min libres). Además,
    cada 30 s revisa si Zernio frenó por límite (429) algún envío al bot, a los
    vendedores o a un workflow (desde el Bloque B esos envíos esperan su turno y salen solos); si
    pasa, **baja solo su ritmo a la mitad** y lo dice en la línea de avance ("Zernio frenó por límite
    (429) 1 envío(s) del CRM: el importador baja a 20 peticiones/min"). Si aun así siguiera
    frenando, Code la corta y la sigue con `--ritmo 15`.
    Al terminar, conteos "después" y la revisión de cero duplicados:
    ```sql
    -- teléfonos repetidos (debe ser 0)
    select regexp_replace(phone_e164, '^\+521(\d{10})$', '+52\1') p, count(*) from contacts
    where phone_e164 is not null group by 1 having count(*) > 1;
    -- wamid repetidos (debe ser 0)
    select provider_message_id, count(*) from messages where provider_message_id is not null
    group by 1 having count(*) > 1;
    -- nada del historial tocó no leídos, ventana ni primera respuesta (debe ser 0)
    select count(*) from conversations cv where cv.channel_id = '<canal oficial>'
      and not exists (select 1 from messages m where m.conversation_id = cv.id and m.imported_at is null)
      and (cv.unread_count > 0 or cv.window_expires_at is not null or cv.first_response_seconds is not null);
    ```
17. **CODE** — Repetir el paso 16 cada ~15 min durante unas 2 horas (Zernio puede seguir
    copiando): cada pasada completa debe terminar en "0 nuevos". Los adjuntos de las
    últimas 2 semanas los baja el worker poco a poco (5 por minuto); los más viejos
    quedan "no disponible" con su tipo.

### D. Validación (en paralelo: no espera a que termine la importación)

18. **YO** — Desde la **app** del celular del oficial, contestar a un cliente de confianza.
    **CODE** — el eco aparece en el CRM como "desde la app" (`source = business_app`) y
    el agente queda en pausa en esa conversación; la ventana de 24 h no cambia.
19. **YO** — Desde un número **externo** (no de prueba), escribir al oficial: aparece en la
    Bandeja en segundos. Contestar desde el CRM → llega al celular con ✓✓.
20. **CODE** — Agente en **AUTO** para el oficial (igual que el interruptor de la pestaña
    Agente IA: `ai_agent_mode = 'auto'`, `ai_agent_mode_changed_at = now()`). Lo copiado
    del celular nunca se contesta solo, aunque la importación siga corriendo. **YO** — otro
    mensaje desde el número externo: el agente contesta solo ese mensaje.
21. **CODE** — `$PROD npm run ads:probe` (anuncios; hoy Meta responde "API access blocked":
    se deja anotado, no frena el go-live).

### E. Cierre

22. **CODE** — `MONITOR_SILENCE_MINUTES` del web de producción: **1440 → 60** (mostrar antes
    y después), para que un silencio de 1 h en horario laboral vuelva a alertar.
23. **CODE** (con **LUZ VERDE: ARCHIVAR N2**) — Archivar N2: apagar su agente → respaldo →
    `$PROD npm run canal:archivar -- --cuenta 6ab6d4483eb3cfc2601c3902` (simula) →
    `… --confirmar` → quitar N2 de `ZERNIO_ALLOWED_ACCOUNT_IDS` conservando el oficial.
    **YO** — en Zernio (perfil "Diluvium Pruebas") desconectar N2.
24. **CODE** — Conteos finales y reporte del día. Borrar los reportes locales de `.historial/`
    (traen teléfonos de clientes; se escriben solo legibles por el dueño del archivo) cuando ya
    no hagan falta. Después: la revisión final de Codex.

**Después del número oficial (no bloquea el día):** sembrar los ~17 Fragmentos curados con
la lista que pase el dueño.

### Prueba de carga del importador (26-sep-2026, local)

`npm run historial:prueba-carga` (solo en una base local cuyo nombre diga "carga"; la
borra): 1,500 chats y 50,000 mensajes con la forma de la API de Zernio servidos por
HTTP, contra 10,901 contactos tipo GHL. Resultados en "Estado y relevo" de este archivo.

## 1. Cuenta del número en Zernio

1. Conectar el número en Zernio (coexistencia) y anotar su `accountId`:
   `GET https://zernio.com/api/v1/accounts` (o `GET /v1/phone-numbers` → `connected`).
2. Confirmar que NO es el sandbox (`isSandbox` ausente/false). El sandbox solo acepta
   un teléfono verificado por usuario; el número real recibe de cualquier número.

## 2. Variables de entorno (web **y** worker de producción)

- `ZERNIO_ALLOWED_ACCOUNT_IDS` = ids separados por coma. Agregar el `accountId` real
  (y quitar el del sandbox cuando ya no se use en prod).
- `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET` ya existen; si se crea un webhook nuevo,
  su secret cambia → actualizar `ZERNIO_WEBHOOK_SECRET` en web y worker.

## 3. Fila en `channels` (base de producción)

La organización del mensaje sale del canal, nunca del payload. Sin fila activa, la
ingesta reintenta y termina en dead-letter. Se crea con
`npm run canal:oficial -- --cuenta <accountId> --conectado <hora ISO> [--confirmar]`
(canal real sin marca Prueba, activo, agente apagado, `connected_at` = red de seguridad
del historial; guion paso 11). Ya no se escribe el INSERT a mano.

## 4. Webhook de Zernio

- Un solo webhook por entorno. Hoy el webhook `6aada7b42e8ced562ab17997` se llama
  "crm-diluvium staging" pero **apunta a producción**
  (`https://crm-diluvium-production.up.railway.app/api/webhooks/zernio`); renombrarlo
  y crear uno propio para staging si se vuelve a probar allí.
- Eventos suscritos: `message.received`, `message.sent`, `message.delivered`,
  `message.read`, `message.failed`, **`reaction.received`, `message.edited`,
  `message.deleted`** (los tres últimos los procesa la ingesta desde `fix/webhook-inbound`).
- Verificar: `GET /v1/webhooks/settings` → `isActive: true`, `failureCount: 0`;
  `POST /v1/webhooks/test` → 200.

## 5. Datos

- Backfill de teléfonos (partes por país, México +52 + 10, país vacío):
  `npx tsx scripts/backfill-phone-parts.ts` (simulación) y luego `--apply`.
  Staging primero; producción solo con OK del dueño.

## 5b. Monitoreo: umbral de silencio

Hasta el go-live, el web de producción tiene `MONITOR_SILENCE_MINUTES=1440` (el sandbox
casi no tiene tráfico y la alerta de silencio saltaba cada 15 min; issue #7). **Al conectar
el número real, regresar `MONITOR_SILENCE_MINUTES` a 60** (Railway → crm-diluvium →
production → Variables) para que un silencio de 1 h en horario laboral vuelva a alertar.

## 6. Prueba de humo

1. Desde un teléfono que NO sea de prueba, mandar texto, foto y PDF al número real.
2. Debe aparecer en Bandeja (y en Contactos, columna Inbox, arriba) en segundos.
3. Responder desde el CRM → llega al celular con ✓✓.
4. Revisar: `select count(*) from webhook_events where processed_at is null` = 0 y
   `dead_lettered_at is not null` = 0.

## Riesgo conocido (aceptado hasta la fusión de contactos)

Si un mismo cliente ya existe como DOS contactos, cada uno con su conversación (p. ej.
uno importado de GHL con su teléfono y otro creado solo por BSUID), la ingesta no
reasigna ni fusiona: cada mensaje sigue a la conversación por la que llega, así que el
historial queda repartido. No se pierde nada y cada caso deja en los logs del worker
`[ingest] identidad: … revisar para fusionar` con ambos ids. Se resuelve con la
herramienta de fusión de contactos (pendiente, junto con los 5 grupos de duplicados de
GHL). Mientras tanto: buscar esa línea en los logs tras el go-live.

## Monitoreo (Fase 3)

Dos vigilantes independientes; ninguno depende de WhatsApp ni de Zernio para avisar:

| Vigilante | Frecuencia | Qué revisa | Aviso |
|---|---|---|---|
| Worker (`worker/index.ts`) | cada 5 min (y al arrancar) | silencio de webhooks en horario laboral (lun–sáb 9–19 Mazatlán, `MONITOR_SILENCE_MINUTES`, 60 por omisión), eventos sin procesar > 5 min, dead-letter, cuarentena **y la cuenta de WhatsApp en Zernio** (a cualquier hora) | log `[monitor] ALERTA: …` en Railway; si todo va bien, `[monitor] entrada de WhatsApp sana · cuentas de WhatsApp: 1 conectada(s)` |
| GitHub Action `inbound-monitor` | cada 15 min | lo mismo vía `GET /api/health/inbound` + latido del worker (Redis) + webhook de Zernio activo y sin fallos. El endpoint revisa la cuenta en Zernio **por su cuenta** (no depende del worker) | issue `alerta-whatsapp` (llega por correo); se cierra solo al sanar. Si el CRM no responde, también abre issue |

### Alarma de desconexión (cuenta de WhatsApp en Zernio, 27-sep-2026)

Por cada canal de Zernio **activo y no archivado**, los dos vigilantes consultan (solo GET, 10 s de
tiempo máximo) `GET /v1/accounts/{accountId}/health` y `GET /v1/whatsapp/account-events?accountId=`.
Código: `lib/monitoring/zernio-account.ts` (reglas, puro), `account-health.ts` (Zernio/Redis),
`status-pill.ts` (pastilla). Forma real de las respuestas: `lib/monitoring/__fixtures__/`.

| Estado | Cuándo | ¿Alerta? |
|---|---|---|
| Rojo | `platformConnection.status` no es `connected` (incluye `unknown`), `inboundWebhookSubscribed` = false, `status` = `error`, o Zernio responde **404** (la cuenta ya no está conectada en Zernio) | en cada revisión, **a cualquier hora** |
| Ámbar | `status` = `warning`, o `PRIMARY_INACTIVITY` (el celular lleva días sin abrir la app de WhatsApp Business: **abrirla**) | en cada revisión si lo dice health |
| Ámbar | evento de desconexión **nuevo** (posterior a la primera revisión) y health ya conectado: "se desconectó a las HH:MM y ya volvió"; o evento `PRIMARY_INACTIVITY` | **una vez** por vigilante; la pastilla lo muestra 24 h |
| — | Zernio no respondió, 5xx o respuesta rara | "no se pudo revisar" (alerta como tal, **nunca** como desconectado); se conserva la última revisión buena |

- Los eventos anteriores a la **primera revisión** (guardada en Redis, `monitor:whatsapp-accounts:baseline`)
  nunca alertan: el `ACCOUNT_OFFBOARDED` del 27-sep 01:27Z no abre issue. Sí sirven para el "desde HH:MM".
- El resultado se guarda en Redis con la hora (`monitor:whatsapp-accounts`; el webhook de Zernio que
  revisó el endpoint, en `monitor:zernio-webhook`). El **Dashboard** lo lee de ahí y **no llama a Zernio**
  al cargar: pastilla verde "WhatsApp conectado", ámbar "WhatsApp: revisar", roja "WhatsApp desconectado
  desde HH:MM" (Mazatlán) o gris "Sin revisar desde HH:MM" si la última revisión tiene más de 15 min
  (p. ej. worker caído o Zernio sin responder). Al hacer clic: número, último mensaje de un cliente, worker
  y webhook de Zernio.
- El issue es público: solo lleva estados, conteos y horas (nada de números, nombres ni ids).
- **Qué hacer si sale rojo:** abrir el Dashboard de Zernio (Accounts) y el WhatsApp Business del celular;
  si Meta sacó la coexistencia (`ACCOUNT_OFFBOARDED`: el número se registró en otro dispositivo),
  reconectar en Zernio con el mismo número (si aparece #3441061, ver Herramientas → Listas en la app).
  En staging el canal es el sandbox compartido de Zernio, que no es una cuenta propia: su health da 404
  y la pastilla de staging sale roja (esperado).

Configurar una vez (el dueño pega el valor; nunca en el chat):

1. Generar un token largo al azar (p. ej. `openssl rand -hex 32`).
2. Railway → servicio web de **producción** → variable `MONITOR_TOKEN` = ese valor.
3. GitHub → Settings → Secrets and variables → Actions → secret de repositorio
   `MONITOR_TOKEN` = el mismo valor.
4. Verificar a mano: Actions → inbound-monitor → Run workflow.

Riesgos aceptados del monitoreo y de las miniaturas:

- **GitHub apaga las Actions programadas** de un repo público tras 60 días sin actividad
  (mismo riesgo ya aceptado para los respaldos, CLAUDE.md §10.6). Si el repo lleva
  semanas sin commits, revisar que `inbound-monitor` siga activo (Actions → reactivar).
  El chequeo del worker (logs) sigue corriendo aunque la Action se apague.
- **Miniaturas de PDF:** el render corre en un proceso hijo con heap limitado, 20 s
  máximo, un PDF a la vez y PDFs de hasta 10 MB; aun así comparte la memoria del
  contenedor del worker (no hay un contenedor aparte). Si un PDF extremo tumbara el
  worker, Railway lo reinicia y el intento ya quedó contado (3 como máximo).

El endpoint solo devuelve conteos (el repo es público). Sin `MONITOR_TOKEN` responde 401 y
la Action abre un issue, así que el paso 2 va antes que el merge a `main`.

## Sandbox de Zernio (pruebas antes del número real)

- La sesión del teléfono de prueba (52 668 242 6364) vence el **25-sep-2026 21:14 UTC**
  (`GET /v1/whatsapp/sandbox/sessions` → `expiresAt`). Una sesión activada dura 7 días; una
  pendiente, 24 h ([doc](https://docs.zernio.com/whatsapp/create-whatsapp-sandbox-session.mdx)).
- No hay endpoint para "extender": se **renueva re-creándola** para el MISMO teléfono
  (idempotente; reenvía la plantilla `sandbox_start`):
  `POST https://zernio.com/api/v1/whatsapp/sandbox/sessions` con `{"phone": "+526682426364"}`
  y `Authorization: Bearer <ZERNIO_API_KEY>`. La sesión queda `pending` hasta que el teléfono
  **responda** la plantilla en WhatsApp; entonces pasa a `active` por 7 días más. Funciona
  también después de vencida.
- Un solo teléfono por usuario de Zernio: para probar con otro hay que revocar el actual
  (`DELETE /v1/whatsapp/sandbox/sessions/{id}`) y crear el nuevo. Límite: 50 mensajes / 24 h.
- Renovarla justo antes de la prueba en vivo del Agente IA (Fase B), no antes.

## Historial del oficial: estado y relevo (feat/historial-oficial, 26-sep-2026)

Chat de Code "Preparar historial del oficial". Solo preparó y probó: **no conectó ni escaneó nada**.

**Qué cambió en el importador** (`npm run historial:importar`):
- Recorre TODAS las páginas: chats activos y archivados en orden ascendente (un chat que se
  mueve mientras se pagina se ve dos veces, nunca cero), mensajes de 100 en 100, agenda de 200
  en 200. Cursor repetido, `hasMore` sin cursor o listado incompleto (`meta.accountsFailed`) =
  se detiene en vez de saltarse páginas.
- Ritmo propio 40 peticiones/min (`--ritmo`), respeta `X-RateLimit-Remaining/Reset` dejando 15
  para el CRM, espera `Retry-After` en 429 y reintenta 5xx/red con espera creciente (2 s → 60 s).
- Un INSERT por página (no uno por mensaje), avance "chat 350 de 1,200 · … · faltan ~N min",
  punto de reanudación por chat en `.historial/<cuenta>.estado.json` (Ctrl+C = corte ordenado;
  el mismo comando sigue). Terminada una corrida, la siguiente es una pasada completa.
- Regla del dueño: un chat se pega al contacto con ese teléfono normalizado; si hay MÁS de uno,
  no se importa y se reporta ("ambiguos"). Solo se crea contacto si no hay ninguno (Inbox,
  `historial_celular`, sin marca Prueba en el oficial). La agenda solo rellena nombres vacíos.
- Tiempo real: la migración **0039** deja que la transacción del importador apague el aviso por
  fila; se manda UNA señal `inbox.bulk` cada 500 mensajes o 5 s. La Bandeja relee su lista una
  vez por señal; el Embudo relee el tablero a lo más cada 30 s si nacieron contactos.
- Adjuntos: los de más de 2 semanas quedan "no disponible" con su tipo al importar (no gastan
  peticiones); los recientes los baja el worker a 5 por minuto, después de los vivos.
- Agente: el historial ya no cuenta como "pendiente" ni como entrante nuevo
  (`lib/ai/runtime/context.ts`): un "gracias" viejo sin contestar no se responde junto con el
  primer mensaje vivo del cliente.
- `npm run canal:oficial` da de alta el canal real (sin SQL a mano).
- `--simular --muestra 50`: reporte previo de los 50 chats más recientes (2 a 4 min), mismo
  reporte de 10 líneas; la duración se extrapola a la importación completa. Nunca escribe.
- Avance visible: la última línea también queda en `.historial/<cuenta>.avance.txt`.
- Freno automático: si mientras importa Zernio le rechaza por límite (429) un envío al CRM en
  vivo, el importador baja su ritmo a la mitad (lo revisa cada 30 s con la hora de la base).

**Lectura real de N2 en producción (26-sep, solo GET a Zernio y base en solo lectura):**
paginación por cursor confirmada (conversaciones `updatedTime_cuenta_id` en orden
ascendente, mensajes `db:<fecha>_<id>`; con límites de 1 y 2 se recorren los mismos ids que
con 100), encabezados `X-RateLimit-Limit: 60` / `Remaining` / `Reset` (segundos Unix).
**Zernio NO manda `isGroup`**: un grupo se reconoce por su participante (`…@g.us` o varios
remitentes) y nunca se pega a un miembro. Fechas: los 6 mensajes del historial de N2 son
del 19, 20 y 25 de septiembre, ANTES de la conexión (25-sep 20:06Z), con `createdAt` =
`sentAt` = hora original de WhatsApp. `--simular` y `--simular --muestra 50` contra N2 dieron
lo mismo: 6 chats, 6 mensajes del historial, los 6 ya en el CRM (0 nuevos, 0 duplicados),
121 mensajes vivos saltados, 14 s y 9 peticiones.

**Prueba de carga local (26-sep, `npm run historial:prueba-carga`)** — 1,500 chats, 50,000
mensajes (49,979 del historial; el más grande de 2,498 = 25 páginas), 10,901 contactos tipo
GHL, 429 y 502 inyectados:

| Corrida | Duración | Resultado |
|---|---|---|
| Simulación | 29 s | 1,721 peticiones; 900 chats → GHL, 598 nuevos, 1 grupo, 1 sin teléfono; 0 ambiguos |
| Importación cortada a la mitad | 14 s | cortó en el chat 751; 3,167 mensajes |
| Reanudación (mismo comando) | 25 s | saltó 750 chats; 46,812 nuevos; 10 repetidos del chat a medias (no duplicados) |
| Segunda corrida completa | 35 s | 0 nuevos, 49,979 ya estaban |

Verificación: 11,500 contactos = 10,902 + 598 nuevos; **0 teléfonos duplicados, 0
conversaciones duplicadas, 0 wamid duplicados**, 0 nuevos con +521, 0 nuevos con marca Prueba o
fuera de Inbox, 0 conversaciones con no leídos/ventana/primera respuesta, 96 nombres rellenados
por la agenda, 0 contactos creados solo por la agenda. Tiempo real: **94 avisos `inbox.bulk` y
cero avisos por fila** durante la importación (antes serían ~50,000). Bandeja DURANTE la
importación: lista p50 8 ms, p95 29 ms, máx 34 ms, 0 errores; después: primera página 13 ms, hilo
de 2,498 mensajes 4 ms, señales del Embudo 14 ms. Memoria: heap pico 180 MB (incluye el Zernio
falso con los 50,000 mensajes en memoria). **Con Zernio real** el límite manda: ~1,720
peticiones a 40/min ≈ **43 min** la importación completa. La **muestra de 50** hizo 155
peticiones (≈ 4 min a 40/min) porque en el mundo sintético esos 50 chats sumaban 10,881
mensajes; con chats de tamaño normal (~40 mensajes) son ~80 peticiones ≈ 2 min. La
muestra no escribió nada (mismo conteo antes y después).

**Lista teórica (sin escenario real hoy):**
- Si Zernio mandara el historial TAMBIÉN por webhook (con N2 no pasó: 0 webhooks), cada mensaje
  avisaría por fila y la Bandeja recargaría filas; lo importado igual no se duplica.
- Un contacto que hoy existe SOLO por BSUID (sin teléfono) no se reconoce por el teléfono del
  chat: nacería otro contacto. En producción no hay contactos solo-BSUID del oficial (no está
  conectado).
- El modelo recibe el historial como contexto; si el último mensaje viejo del cliente quedó sin
  contestar, va pegado al primer mensaje vivo en el mismo turno (sin hora) y el agente podría
  mencionarlo. Ya NO cuenta como pendiente (ni comprobante, ni corte del lote).
- El barrido de media del historial toma lo más reciente primero: 5 adjuntos que fallen siempre
  ocupan su turno hasta agotar sus 25 intentos (~25 min) antes de pasar a otros.
- Un 429 de Zernio en un envío del vendedor, del bot o de un workflow ya no falla (Bloque B,
  28-sep-2026): espera su turno y sale solo con la misma clave (tope 5 min). El importador deja ~20
  peticiones/min libres; si hubiera ráfagas mayores, bajar `--ritmo`.
- La agenda del celular puede tener un nombre distinto al de GHL: nunca lo cambia (regla), así
  que no se "mejora" un nombre ya puesto.
- Los ~17 Fragmentos curados: no bloquean el día; se siembran después con la lista del dueño.
