# Investigación: atribución de anuncios de clic a WhatsApp (CTWA)

**Estado:** investigado el 18-sep-2026. **Implementado el 24-sep-2026** (niveles 1 y 2, sin métricas de
gasto ni Conversions API): ver `docs/anuncios.md`.
Lo único que se hace YA es **guardar los datos del anuncio** de cada conversación, porque Meta
los manda UNA sola vez (en el primer mensaje tras el clic) y no se pueden recuperar después.

## Pregunta
¿La tarjeta "Llegó por anuncio" puede decir de qué anuncio viene cada contacto, y servir para saber
qué anuncios activos atraen más clientes?

## Respuesta corta: sí, en tres niveles

1. **Qué anuncio (directo del mensaje).** Cuando alguien toca "Enviar mensaje" en un anuncio, Meta
   agrega un objeto `referral` al PRIMER mensaje entrante con:
   - `source_id`: **id del anuncio** en Meta Ads.
   - `source_url`, `headline`, `body`, `media_type`, `image_url`/`video_url`/`thumbnail_url`: copia del
     creativo (para la tarjeta compacta).
   - `ctwa_clid`: **id único del clic**, que sirve para devolverle conversiones a Meta.

   Zernio ya lo entrega en `metadata.referral` de `message.received` (su adaptador oficial lo tipa) y
   además lo guarda en la conversación (`metadata.ctwa_clid`, `ctwa_source_id`, `ctwa_headline`…).
   Solo se captura una vez: los mensajes posteriores no lo repiten.

2. **Nombre de campaña, conjunto y anuncio + gasto.** Con el `source_id` (id del anuncio), la
   **Marketing API de Meta** (Ads Insights) devuelve nombre del anuncio, conjunto y campaña, estado
   (activo o pausado), gasto, impresiones y clics. Requiere un token con `ads_read` sobre la cuenta
   publicitaria del portafolio **"Grupo Diluvium"** (el mismo de la WABA). Con eso, un reporte del
   CRM puede cruzar **gasto de Meta** con **contactos, etapas alcanzadas y ventas del CRM** por anuncio:
   "qué anuncio trae más clientes y no solo más clics".

3. **Devolverle las ventas a Meta (para que optimice mejor).** Conversions API para mensajería
   (`action_source = business_messaging`, `messaging_channel = whatsapp`) con el `ctwa_clid`:
   eventos `LeadSubmitted` o `Purchase` (valor y moneda). Zernio lo ofrece hecho:
   `POST /v1/whatsapp/dataset` (una vez por WABA) y `POST /v1/whatsapp/conversions` con
   `conversationId` (reusa el `ctwa_clid` capturado). Ejemplo de uso: cuando un contacto pasa a la
   etapa "compra" en el tablero, se manda `Purchase` y Meta optimiza los anuncios hacia quien compra.

## Requisitos y riesgos
- **Activar "atribución de anuncios"** en la configuración de WhatsApp Business. Sin eso, Meta no manda
  el `referral`. Verificar al conectar el número real.
- El `referral` solo llega si el cliente escribe **desde el anuncio**. Si escribe directo, no hay dato.
- Conversions API: el token de la WABA debe tener `whatsapp_business_manage_events` (con Embedded Signup
  ya lo trae); el dataset debe ser del mismo Business Manager.
- El `ctwa_clid` **no** se hashea al enviarlo; el email y `externalId` sí (Zernio lo hace).
- El historial previo (GHL) trae los datos del anuncio como texto dentro del mensaje (ver la captura
  de GHL del 18-sep: `ctwaClid`, `sourceId`…). Al migrar se puede extraer y atribuir también.

## Para implementar después (propuesta)
1. (YA, en la bandeja) Guardar `referral` en el mensaje y el primero en la conversación.
2. Tarjeta "📣 Llegó por anuncio": titular + miniatura + nombre del anuncio (si ya se consultó).
3. Consulta periódica a la Marketing API: `source_id` → nombre, campaña, estado y gasto (cache en DB).
4. Reporte "Anuncios": por anuncio → contactos nuevos, % que llega a cada etapa, ventas, costo por contacto.
5. Conversions API vía Zernio: `LeadSubmitted` / `Purchase` al mover la tarjeta a ciertas etapas.

## Fuentes
- Meta, webhook de mensajes (objeto `referral`): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text
- Zernio, Click-to-WhatsApp Ads (captura del clid, dataset y conversiones): https://docs.zernio.com/platforms/whatsapp/ctwa
- Meta Conversions API, parámetros: https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters
- Requisitos del `ctwa_clid` (atribución activada): https://whapi.cloud/blog/track-click-to-whatsapp-ctwa-clid
- AWS, eventos de conversión de WhatsApp: https://docs.aws.amazon.com/social-messaging/latest/userguide/conversions-api.html
