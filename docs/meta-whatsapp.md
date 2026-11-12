# Gasto de WhatsApp (Meta): la marca de Meta y lo que reporta Meta

Pedido del dueño (4-nov-2026): saber el gasto **exacto** de WhatsApp sin revisarlo a mano cada mes y saber **qué
mensajes cuestan** (Ángela, automatizaciones, seguimientos, vendedores). Todo en segundo plano: **nada se ve en la
Bandeja ni en el Embudo**, solo en el Dashboard (tarjeta «WhatsApp (Meta)» y su sección «Gasto de WhatsApp»).
No gasta IA (no llama a ningún modelo) ni cuesta en Zernio (Zernio cobra mensajes enviados y cuentas; leer es gratis).

Antes (hasta el 3-nov-2026) el correo del día 3 estimaba a Meta con un conteo propio del CRM que contaba ~14 % de más
(3,403 contra 2,985 en octubre) y con tarifas calibradas a una cifra equivocada: octubre salió en US$49.06 y Meta cobró
**US$44.16** (sin IVA; Meta no cobra IVA). Detalle en Notion «Gastos CRM Sep/Oct».

## Dos fuentes

| | De dónde | Para qué |
|---|---|---|
| **Lo que reporta Meta** | El worker lee **cada hora** (y al arrancar) `GET /v1/whatsapp/pricing-analytics` de Zernio con la misma `ZERNIO_API_KEY` (Zernio lo toma en vivo de `pricing_analytics` de Meta). Por día UTC, categoría y tipo de precio, desde el día 1 del mes anterior. Tabla `meta_whatsapp_pricing` (+ `meta_whatsapp_pricing_sync`: última lectura y error). | Los **mensajes** de cada tipo (cobrados y gratis), los mismos de WhatsApp Manager › Precios de mensajes. Meta NO da el **costo** a esta cuenta («COST is not shown for businesses who bill through a partner», 11-nov-2026: pedirlo hace que rechace toda la consulta), así que el monto = mensajes cobrados × lo que cobra Meta por mensaje (`META_RATE_USD` en lib/meta-whatsapp/rates.ts, sacado de octubre: 0.040696 marketing, 0.008406 utilidad, 0.011463 normal; con los mensajes de octubre da US$44.09, igual que la página de Meta). Lo usa el correo del día 3. |
| **La marca de Meta en cada mensaje** | Meta manda en sus avisos de estado `pricing` {billable, category, type} y `billingConversation` {id, expiresAt, originType}; Zernio los pasa en `message.delivered/read/sent/failed` (docs.zernio.com/webhooks/inbox). Columnas `messages.meta_billable`, `meta_category`, `meta_pricing_type`, `meta_window_expires_at`, `meta_window_origin` (migración 0080; en staging se aplicó primero como 0078 y se renumeró porque la 0079 entró antes a main). | **Quién** gastó: cada saliente cobrado se cuenta por su origen y su costo es aproximado (mensajes × lo que cobró Meta en promedio por mensaje de ese tipo en el periodo). La ventana guardada servirá para saber cuándo deja de ser gratis cada chat. |

- La marca llega solo en uno de los avisos (Meta la deja en null en los demás): se guarda lo que trae y un aviso sin
  marca nunca borra la anterior (`lib/messaging/meta-mark.ts`, `ingest.ts` › `ingestStatus`).
- **Relleno:** al arrancar, el worker le pone la marca a los salientes de los últimos 8 días con los avisos que todavía
  guarda `webhook_events` (se borran a los 7 días). Nunca pisa una marca que ya llegó y nunca cruza organizaciones
  (`lib/meta-whatsapp/backfill.ts`). Lo de antes del relleno no tiene marca: para esos meses solo hay lo que reporta Meta.
- No se sabe aún si los mensajes del **celular o WhatsApp Web** traen marca (Zernio no lo dice). Por las reglas de Meta
  (coexistencia, docs/seguimientos.md [M4]) no se cobran; la sección los cuenta aparte como gratis y, si Meta llegara a
  marcar alguno como cobrado, saldría en «¿Quién lo gastó?» como «Celular o WhatsApp Web».

## Orígenes («¿Quién lo gastó?»)

En este orden (`lib/dashboard/meta-whatsapp.ts`): **Seguimientos** (`metadata.seguimiento`) → **Automatizaciones** (el
mensaje está en `workflow_runs.message_ids`: palabra clave, comando del vendedor como /Precio2, Agente IA o etapa) →
**Ángela** (`source = ai_agent`) → **Vendedores desde el CRM** (`crm`) → **Celular o WhatsApp Web** (`business_app`).
«Lo que más cuesta» lista las automatizaciones (por nombre) y las plantillas (por nombre) con su costo aproximado.

## Celular y WhatsApp Web: el ahorro (11-nov-2026, pedido del dueño)

Lo que un vendedor manda desde la app del celular o WhatsApp Web no lo cobra Meta (coexistencia, docs/seguimientos.md
[M4]); desde el CRM sí. El dueño pidió llevar el registro y evaluarlo cada mes para saber si de verdad se ahorra.
`lib/meta-whatsapp/ahorro-celular.ts` toma cada mensaje con `source = business_app` (sin importados ni canales de prueba)
y calcula cuánto habría costado desde el CRM:

| Situación del chat en ese momento | Desde el CRM habría sido | Ahorro |
|---|---|---|
| Tiempo gratis del anuncio (marca de Meta `free_entry_point` vigente o, sin marca, las 72 h del CRM) | gratis | 0 |
| Abierto (el cliente escribió en las últimas 24 h), antes de que se acaben los 1,000 normales gratis del mes | gratis | 0 |
| Abierto, ya sin los 1,000 gratis (el día sale de `free_customer_service` de Meta; sin dato del mes, el día 7) | mensaje normal | lo que cobró Meta por normal ese mes |
| Cerrado (el cliente no escribió en 24 h) | una plantilla de marketing por chat y día | lo que cobró Meta por marketing ese mes |

Si Meta marca alguno de esos mensajes como cobrado, no cuenta como ahorro y se dice aparte en naranja: sería la señal de
que la regla no se cumple. Antes de oct-2026 los normales eran gratis. No hay tabla nueva: se calcula con lo guardado
(mensajes y lo que reporta Meta), que no se borra. Se ve en la sección (tarjeta «Celular y WhatsApp Web» con el periodo y
los últimos 6 meses) y en el correo del día 3 (una línea; no suma al total porque es lo que NO se pagó).

## El correo del día 3

`lib/costos/cargar.ts` › `cargarMetaReportado`: si hay renglones del mes y la última lectura buena es de **después** de
que cerró el mes (días UTC), el renglón de Meta dice «lo que reporta Meta (N mensajes cobrados); Meta lo cobra el día 1,
sin IVA». Si no (Zernio falló), sale el estimado del CRM con las tarifas reales de octubre y la nota «suele contar de más».

## Si algo falla

- La tarjeta dice «Sin actualizar desde hace…» (más de 3 h) o «No se pudo leer el cobro de Meta»: el error queda en
  `meta_whatsapp_pricing_sync.last_error` (sin la llave) y en el log del worker `[meta-cobro]`. Lo de antes se queda.
- Meta avisa que sus cifras son aproximadas y pueden tardar unas horas; la factura manda. En octubre la página de
  Meta dio US$44.09 y la factura US$44.16.
- Meta no da el costo a negocios que pagan por medio de un socio (no es el caso: Diluvium paga directo con la Visa).

## Reemplaza a

La rama `feat/meta-costos` (worker con el token de Meta, nunca entró a main): con Zernio ya no hace falta ese token.
