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
| **Lo que reporta Meta** | El worker lee **cada hora** (y al arrancar) `GET /v1/whatsapp/pricing-analytics` de Zernio con la misma `ZERNIO_API_KEY` (Zernio lo toma en vivo de `pricing_analytics` de Meta). Por día UTC, categoría y tipo de precio, desde el día 1 del mes anterior. Tabla `meta_whatsapp_pricing` (+ `meta_whatsapp_pricing_sync`: última lectura y error). | El **monto** (el mismo de WhatsApp Manager › Precios de mensajes y de la factura), por tipo de mensaje y lo que salió gratis. Lo usa el correo del día 3. |
| **La marca de Meta en cada mensaje** | Meta manda en sus avisos de estado `pricing` {billable, category, type} y `billingConversation` {id, expiresAt, originType}; Zernio los pasa en `message.delivered/read/sent/failed` (docs.zernio.com/webhooks/inbox). Columnas `messages.meta_billable`, `meta_category`, `meta_pricing_type`, `meta_window_expires_at`, `meta_window_origin` (migración 0078). | **Quién** gastó: cada saliente cobrado se cuenta por su origen y su costo es aproximado (mensajes × lo que cobró Meta en promedio por mensaje de ese tipo en el periodo). La ventana guardada servirá para saber cuándo deja de ser gratis cada chat. |

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
