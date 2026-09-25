# Número de prueba (N2) — conexión, historial y guion de pruebas

> Chat de Code "Número de prueba y Mac" (25-sep-2026). Rama `feat/numero-prueba`.
> Si te quedas sin contexto, la sección **Estado y relevo** (al final) dice dónde vamos.

## Los 3 números

| | Número | Canal en el CRM | Cuenta |
|---|---|---|---|
| **N1** Sandbox de Zernio | +1 202 908 7457 (compartido) | `ch_zernio_sandbox`, marcado **Prueba** | accountId `6a180a034c7f364ffded3c9c` (no es "cuenta conectada" en Zernio) |
| **N2** Número de prueba | chip propio, WhatsApp Business > 7 días | `ch_zernio_<accountId>`, marcado **Prueba**, en PRODUCCIÓN | se conoce al conectarlo |
| **N3** Oficial | +52 668 241 9579 | — (después) | — |

N1 se **archiva** sin borrar su historial (paso 8). N2 se quita cuando entre el oficial.

## 1. Lo que dice Zernio (con fuente)

**a) Conectar un número de la app de WhatsApp Business (coexistencia, QR).**
Fuente: <https://docs.zernio.com/platforms/whatsapp/connection> y <https://docs.zernio.com/connect/get-connect-url>
- Zernio → **Connections** → tarjeta **WhatsApp** → **+ Connect** → **Use my own number** → se abre la
  ventana de Meta (Embedded Signup) → **Connect existing WhatsApp Business app account** (eso activa la
  coexistencia) → Meta muestra un **QR** → en el celular: app WhatsApp Business → ícono de **cámara**
  arriba a la derecha (o Ajustes → Dispositivos vinculados) → escanear → confirmar en el navegador.
- **Un número por perfil de Zernio** (error 409 `ONE_WHATSAPP_PER_PROFILE`): N2 va en un perfil nuevo
  "Diluvium Pruebas" para dejar el perfil **Default** libre para el oficial (N2 y N3 coexistirán un rato).
- Requisitos documentados: número activo en la app **WhatsApp Business** (no la normal); si Meta responde
  133010 (`whatsapp_coexistence_not_registered`) no se crea nada: abrir y actualizar WhatsApp Business en
  el celular, dejarla abierta y repetir. Meta pide la app en versión **2.24.17 o mayor**
  (<https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users>).
- **No documentado:** cómo crear un portafolio de Meta NUEVO dentro de la ventana (Zernio solo dice que
  la WABA "se puede crear durante el flujo"), los "7 días", país y PIN de dos pasos.

**b) Historial, contactos y ecos.**
Fuentes: <https://docs.zernio.com/webhooks/inbox>, <https://docs.zernio.com/messages/get-inbox-conversation-messages>,
<https://docs.zernio.com/platforms/whatsapp/connection>
- Zernio **no reenvía** los webhooks crudos de Meta (`history`, `smb_app_state_sync`, `smb_message_echoes`):
  su lista de eventos no los tiene. Copia **hasta 6 meses** de chats a su bandeja y los contactos de la app
  a su CRM (`/v1/contacts`).
- Los mensajes del historial se ven por API (`GET /v1/inbox/conversations/{id}/messages`) con
  `metadata.source: "coexistence_history"`; el `id` de cada mensaje es el **wamid** (el mismo que el webhook
  manda como `platformMessageId`), así que no se duplica nada.
- **No documentado:** si el historial ADEMÁS dispara `message.received`/`message.sent`, y cuándo termina.
  Por eso el CRM hace las dos cosas: **jala** el historial por API (`npm run historial:importar`) y, si
  llegara por webhook, lo reconoce por `coexistence_history` y lo trata igual (sin agente).
- Quién pide la copia a Meta: Zernio, sola, al conectar (su error 133010 dice que Meta "rechazó la
  sincronización de contactos/historial"). **No hay API** para pedirla nosotros. Meta da **24 h** y solo
  **una vez** (<https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/history>).
- Ecos de la app: `message.sent` con `message.source: "whatsapp_business_app"` (ya lo maneja el CRM).

**c) Webhook.** Fuente: <https://docs.zernio.com/webhooks/create-webhook-settings>
- Los webhooks son de toda la cuenta de Zernio salvo que se limiten con `profileIds`/`accountIds`.
  El de producción (`6aada7b42e8ced562ab17997`, "crm-diluvium production") tiene ambas listas **vacías**
  (leído el 25-sep): **N2 llegará solo**, no hay que registrar nada. Lo que llegue antes de permitir la
  cuenta se guarda en **cuarentena** (crudo, 30 días) y se libera con `npm run webhooks:replay`.

**d) Cuentas y cobro.** Fuente: <https://docs.zernio.com/pricing>, <https://docs.zernio.com/accounts/list-accounts>
- Cuentas 1–2 gratis; de la 3.ª a la 10.ª, **$6 USD/mes cada una**.
- Hoy (25-sep, `GET /v1/accounts`): **0 cuentas conectadas** (el sandbox no aparece como cuenta).
  N2 será la 1.ª y N3 la 2.ª: **sin cobro**. Nunca conectar una 3.ª a la vez.

### Pregunta para soporte de Zernio (lista para pegar)

> Hi Zernio team — we're connecting a WhatsApp Business app number via coexistence (onboarding=business_app)
> into a new profile, creating a brand-new Meta business portfolio/WABA in the popup. Questions not covered in the docs:
> 1. Does Zernio call Meta's `POST /{phone-number-id}/smb_app_data` (both `smb_app_state_sync` and `history`)
>    automatically at connect time, within Meta's 24h window? Is there any way for us to trigger or retry it?
> 2. Do history-synced messages (`metadata.source: "coexistence_history"`) fire `message.received`/`message.sent`
>    webhooks, or are they REST-only? If they fire webhooks, is `coexistence_history` present in the webhook payload?
> 3. How do we know when history sync has finished or failed (including Meta error 2593109, history declined)?
> 4. For history messages from the API, is `createdAt`/`sentAt` the ORIGINAL WhatsApp time or the import time?
> 5. History media: do attachments carry a `/v1/whatsapp/media/{id}` URL, and only for the last 14 days as Meta says?
> 6. Contacts from `smb_app_state_sync`: do later adds/removes update Zernio contacts? Any webhook for them?
> 7. In Embedded Signup coexistence, can the user create a NEW business portfolio, and are there prerequisites
>    (minimum days active, country, 2FA PIN)?

**Lo que NO se puede garantizar antes del QR:** que Zernio pida el historial a Meta (lo infiere su
documentación, no lo dice) y que las fechas de la API sean las originales. El importador tiene
`--simular` para verlo ANTES de escribir nada.

## 2–6. Lo que hace el CRM (ya en producción antes del QR)

- **Marca "Prueba" por canal** (`channels.is_test`): nada de lo que entra o sale por N1/N2 cuenta en el
  Dashboard (conversaciones nuevas, desgloses, comparación), ni los contactos que nacieron en ellos
  (`contacts.es_prueba`; un cliente que ya existía, p. ej. importado de GHL, nunca se marca), ni lo importado. Etiqueta **Prueba** en la fila de la Bandeja, la cabecera del chat (también el pop-up del
  Embudo) y la tarjeta del Embudo. El gasto de IA sí cuenta (no se filtra). El Dashboard no muestra la
  primera respuesta; en la base, lo importado nunca la calcula.
- **Varios canales a la vez:** todo envío (vendedor, fragmento, plantilla, programado, workflow, agente)
  pasa por `lib/messaging/send.ts`, que toma la cuenta del canal de SU conversación. Con tests.
- **Eventos en espera:** los de una cuenta no permitida se guardan en cuarentena (200 rápido, sin procesar
  ni agente). `npm run webhooks:replay` los libera cuando la cuenta ya está permitida. Los de un canal
  **archivado** se registran y no se procesan.
- **Historial:** cada chat entra a la conversación de N2 con su fecha, dirección, tipo y adjuntos (el
  worker los descarga), sin duplicados, con la marca discreta **"Importado del celular"**. Nunca dispara
  agente, workflows ni palabras clave; no suma no leídos, no abre ni alarga la ventana, no calcula primera
  respuesta, no pone el semáforo en rojo y no mueve etapa ni temperatura. Los contactos nuevos nacen en
  Inbox, marcados Prueba (source `historial_celular`). La agenda del celular solo **rellena nombres vacíos**
  de contactos que ya existen. Sirve igual para N3.
- **Red de seguridad por hora de conexión** (`channels.connected_at`): lo enviado antes de conectar el
  número es historial aunque llegue por webhook sin marca. Adjuntos viejos sin archivo (Meta solo copia la
  media reciente) quedan como "no disponible" con su tipo, en vez de perderse.
- **Eco de la app:** se guarda como saliente "desde la app", pausa al agente en esa conversación (se
  reactiva solo con "Reactivar") y no toca la ventana de 24 h (ya existía; verificado con tests).

## LISTO PARA ESCANEAR — clics para el usuario

Antes: celular con N2 a la mano, **WhatsApp Business actualizada y abierta**.

1. Entra a **zernio.com** con tu cuenta.
2. Arriba, en el selector de **perfiles**, crea uno nuevo: **Diluvium Pruebas** (y déjalo seleccionado).
3. Menú **Connections** → tarjeta **WhatsApp** → **+ Connect** → **Use my own number**.
4. Se abre la ventana de **Meta**: entra con tu Facebook.
5. Elige **Connect existing WhatsApp Business app account** (conectar la app que ya usas).
6. Cuando pregunte el portafolio de negocio: **crear uno nuevo** llamado **Diluvium Pruebas**.
   ⚠️ **NO elijas "Grupo Diluvium".**
7. Escribe el número N2. Meta muestra un **QR**.
8. En el celular: WhatsApp Business → ícono de **cámara** arriba a la derecha (o Ajustes → Dispositivos
   vinculados) → escanea el QR.
9. En el celular, **acepta compartir el historial de chats y los contactos**.
10. Vuelve al navegador, confirma y termina.
11. Escríbeme **QR HECHO**.

## Después del QR (lo hace Claude)

Comandos desde el worktree, con la base de producción por el proxy público y la llave de Zernio del
servicio `crm-diluvium` (nunca se imprimen). `$PROD` = el prefijo que arma ambas:

```bash
railway run -p a59d3041-d62f-4d10-822f-2e3026ca4f21 -e production -s Postgres -- sh -c 'railway run -p a59d3041-d62f-4d10-822f-2e3026ca4f21 -e production -s crm-diluvium -- env DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$RAILWAY_TCP_PROXY_DOMAIN:$RAILWAY_TCP_PROXY_PORT/$PGDATABASE?sslmode=require" npm run <comando>'
```

1. accountId de N2 y su hora de conexión (solo lectura): `GET /v1/accounts?page=1&limit=100`.
2. Alta del canal **antes** de permitir la cuenta (así no hay hueco):
   `npm run canal:prueba -- --cuenta <N2> --conectado <hora de conexión ISO> --nombre "Número de prueba" --telefono +52… --confirmar`.
   `--conectado` es la red de seguridad: todo lo enviado ANTES de esa hora entra como historial aunque
   Zernio lo mande por webhook sin la marca `coexistence_history` (nunca activa agente ni no leídos).
3. `ZERNIO_ALLOWED_ACCOUNT_IDS` de `crm-diluvium` (production): se agrega `<N2>` conservando lo demás
   (mostrar antes y después). El worker no la usa (solo el webhook y el replay).
4. `npm run webhooks:replay` (libera la cuarentena de N2).
5. `npm run historial:importar -- --cuenta <N2> --simular` → revisar fechas contra el celular → sin `--simular`.
   Repetir cada ~15 min hasta que no entre nada nuevo (Zernio puede copiar en segundo plano).
6. Agente en AUTO para N2 (igual que el interruptor de la pestaña Agente IA: `ai_agent_mode='auto'` y
   `ai_agent_mode_changed_at=now()`; lo copiado antes no se contesta solo).

## 7. Guion de pruebas (con su consulta de solo lectura)

Las consultas se corren con `psql` en modo solo lectura (`PGOPTIONS='-c default_transaction_read_only=on'`).
`:n2` = id del canal de N2 (`ch_zernio_<accountId>`); `:desde` = hora de inicio de la prueba (UTC).

### PRUEBA BÁSICA
Un número escribe a N2 → entra a la Bandeja → el agente contesta → el vendedor contesta desde el CRM y llega al celular.

```sql
select m.sent_at, m.direction, m.source, m.status, left(m.body, 60) as texto, ct.phone_e164
from messages m join conversations cv on cv.id = m.conversation_id join contacts ct on ct.id = cv.contact_id
where cv.channel_id = :'n2' and m.created_at > :'desde' and m.imported_at is null
order by m.sent_at;
-- Esperado: in/contact → out/ai_agent (sent|delivered|read) → out/crm (sent|delivered|read).
```

### Varios números a la vez
Al menos 5 de distintas ladas (668, 667, 55, 33, 81 y un +1 si hay), todos en el mismo minuto.

```sql
select ct.phone_e164, count(*) filter (where m.direction='in') as entrantes,
       count(*) filter (where m.direction='out' and m.source='ai_agent') as respuestas_agente,
       count(distinct cv.id) as conversaciones
from messages m join conversations cv on cv.id = m.conversation_id join contacts ct on ct.id = cv.contact_id
where cv.channel_id = :'n2' and m.created_at > :'desde' and m.imported_at is null
group by ct.phone_e164 order by 1;
-- Esperado: una fila por número, 1 conversación cada uno, sus propias respuestas.
-- Teléfonos +52 + 10 dígitos, NUNCA +521:
select phone_e164 from contacts where phone_e164 like '+521%' and created_at > :'desde';   -- 0 filas
-- Sin duplicados:
select provider_message_id, count(*) from messages where created_at > :'desde' and provider_message_id is not null
group by 1 having count(*) > 1;                                                               -- 0 filas
-- Cada respuesta salió por la conversación de SU cliente (sin cruces):
select m.id, cv.channel_id from messages m join conversations cv on cv.id = m.conversation_id
where m.direction='out' and m.created_at > :'desde' and cv.channel_id <> :'n2';               -- 0 filas
```

### Workflows
Desde un celular: "tamaños", "tapones" y "cómo se instalan". Desde la Bandeja: `/tabla` y `/banco`
(pausan al agente; luego "Reactivar").

```sql
select r.created_at, w.slug, r.trigger, r.status, r.error_code
from workflow_runs r join workflows w on w.id = r.workflow_id join conversations cv on cv.id = r.conversation_id
where cv.channel_id = :'n2' and r.created_at > :'desde' order by r.created_at;
select cv.id, cv.agent_state, cv.agent_state_changed_at from conversations cv where cv.channel_id = :'n2';
-- Esperado: keyword para las palabras (done), command para /tabla y /banco (done);
-- tras /tabla o /banco la conversación queda pausado_humano hasta "Reactivar" (vuelve a activo).
```

### Eco
El vendedor contesta desde la app del celular de N2 → aparece en el CRM y el agente se pausa.

```sql
select m.sent_at, m.source, left(m.body, 60), cv.agent_state, cv.window_expires_at
from messages m join conversations cv on cv.id = m.conversation_id
where cv.channel_id = :'n2' and m.source = 'business_app' and m.imported_at is null and m.created_at > :'desde';
-- Esperado: la fila del eco, agent_state = pausado_humano, window_expires_at igual que antes del eco.
```

### Historial
Lo importado contra lo que se ve en el celular.

```sql
select ct.phone_e164, ct.first_name, count(*) as mensajes, min(m.sent_at) as primero, max(m.sent_at) as ultimo,
       count(*) filter (where jsonb_array_length(m.attachments) > 0) as con_adjuntos
from messages m join conversations cv on cv.id = m.conversation_id join contacts ct on ct.id = cv.contact_id
where cv.channel_id = :'n2' and m.imported_at is not null
group by 1, 2 order by ultimo desc;
-- Nada de lo importado tocó no leídos, ventana ni primera respuesta:
select cv.id, cv.unread_count, cv.window_expires_at, cv.first_response_seconds
from conversations cv where cv.channel_id = :'n2'
  and not exists (select 1 from messages m where m.conversation_id = cv.id and m.imported_at is null);
-- Esperado: unread 0, window null, first_response null en las conversaciones SOLO de historial.
-- El agente no contestó historial:
select count(*) from ai_usage u join messages m on m.id = u.message_id where m.imported_at is not null;  -- 0
```

### Dashboard
Nada de N1 ni de N2 cuenta.

```sql
select count(*) from contacts c
where (c.es_prueba or not exists (
  select 1 from conversations cv join channels ch on ch.id = cv.channel_id and not ch.is_test
  join messages m on m.conversation_id = cv.id where cv.contact_id = c.id and m.direction='in' and m.imported_at is null))
  and c.created_at > :'desde';
-- Son los contactos de la prueba: ninguno debe aparecer en el Dashboard (comparar el total de hoy antes/después).
select id, display_name, is_test, is_active, archived_at, ai_agent_mode from channels;
```

### Plantillas
Fuera de hoy: N2 está en otra cuenta de Meta ("Diluvium Pruebas"); se prueban con el oficial.

## 8. Archivar N1 (solo con **LUZ VERDE: ARCHIVAR SANDBOX**)

1. Respaldo: `gh workflow run db-backup.yml --ref main` y esperar verde (`gh run watch`).
2–4, 6. `npm run canal:archivar -- --cuenta 6a180a034c7f364ffded3c9c` (simula y cuenta) →
   `… --confirmar`: cuenta antes, cancela sin borrar programados y corridas pendientes, apaga el agente,
   deja el canal inactivo + archivado + Prueba (historial visible, composer "Canal archivado"), cuenta
   después y confirma que es igual.
5. Quitar `6a180a034c7f364ffded3c9c` de `ZERNIO_ALLOWED_ACCOUNT_IDS` de `crm-diluvium` (production)
   conservando los demás. El worker NO lee esa variable (solo el webhook y el replay).
7. Reporte. Desconectarlo en Zernio lo hace el usuario (en el sandbox no hay "cuenta" que desconectar:
   basta con no renovar la sesión).

## Lista teórica (sin escenario real hoy)

- La pestaña Plantillas toma el canal activo más nuevo: mientras N1 y N2 estén activos, "Sincronizar"
  apuntaría a la WABA "Diluvium Pruebas" (inofensivo; con N3 apuntará al oficial).
- Un contacto nacido en un canal de prueba que después escribe al oficial conserva "Prueba" y no cuenta en
  el Dashboard (regla "ni los contactos creados por él").
- Un historial muy grande (N3, 6 meses) genera un aviso de tiempo real por mensaje: la Bandeja abierta
  recarga filas durante la importación.
- Los adjuntos del historial de más de ~14 días no traen archivo (Meta): quedan "no disponible". Si una
  corrida posterior del importador sí trae la URL, no se enriquece el mensaje ya guardado.
- Archivar N1 no puede frenar un envío que ya iba en curso al momento de archivar (se reporta y se espera).

## Estado y relevo

- [ ] Rama `feat/numero-prueba` en main y desplegada (web + worker sanos, migración 0032 aplicada).
- [ ] N1 marcado Prueba (`npm run canal:prueba -- --cuenta 6a180a034c7f364ffded3c9c --confirmar`).
- [ ] LISTO PARA ESCANEAR enviado → QR HECHO → pasos "Después del QR".
- [ ] PRUEBA BÁSICA → resto del guion.
- [ ] LUZ VERDE: ARCHIVAR SANDBOX → paso 8.
