# Cobro de Meta por WhatsApp en el Dashboard

Decisión del dueño (5-oct-2026): ver lo que Meta cobra por WhatsApp sin entrar a Meta Business Suite.
Desde el 1-oct-2026 Meta también cobra los mensajes normales dentro de la ventana de 24 h (no solo las
plantillas). Zernio no cobra lo de Meta: Meta lo carga directo a la cuenta de WhatsApp (WABA) de Diluvium.

## Cómo funciona

- El **worker** lee cada hora (y al arrancar) `GET /{META_WABA_ID}?fields=currency,pricing_analytics…`
  de la Graph API, del 1.º del mes anterior a hoy, por día, con las dimensiones `PRICING_CATEGORY` y
  `PRICING_TYPE` (`lib/meta-billing/read.ts`, `sync.ts`). Solo lee: no manda nada ni cuesta nada.
- Guarda la última lectura buena en `meta_whatsapp_billing` (migración 0058; una fila por organización):
  `days` = día UTC → tipo de precio → categoría → `{ volume, cost }`, más la moneda de la WABA. Si Meta
  falla se guarda el error (sin el token) y se conserva lo anterior.
- El **Dashboard** muestra la tarjeta **WhatsApp (Meta)** debajo del Gasto de IA (mismos permisos;
  `lib/dashboard/meta-whatsapp.ts`, `app/(app)/inicio/_components/meta-whatsapp-card.tsx`): total del
  mes y del mes anterior, mensajes que cuentan para cobro (`REGULAR`), gratis por anuncio
  (`FREE_ENTRY_POINT`, 72 h) y gratis de la ventana (`FREE_CUSTOMER_SERVICE` y cualquier otro tipo), y
  lo cobrable por categoría. Sin fila (sin token) no hay tarjeta.
- Las cifras son **aproximadas** según Meta y pueden diferir de la factura. El saldo pendiente y el pago
  siguen en Business Suite › Facturación y pagos. Lo enviado desde la app del celular (coexistencia) no
  se cobra.

## Variables (solo en el worker)

- `META_WHATSAPP_TOKEN`: usuario del sistema del portafolio «Grupo Diluvium» con **solo**
  `whatsapp_business_management`, la WABA «Diluvium» asignada con el acceso más chico que deje ver
  análisis/costos y la app «CRM Diluvium»; caducidad «Nunca». Va en el encabezado `Authorization`.
  El permiso también permite administrar la WABA: el CRM solo hace el GET de arriba.
- `META_WABA_ID`: id numérico de la WABA (no es secreto).
- Opcionales compartidas con Anuncios: `META_GRAPH_API_VERSION`, `META_APP_SECRET`.

Carga: primero `worker` de staging para probar; después `worker-production` y se borran de staging
(como las llaves de administración de IA). `railway variable delete` no redespliega: redesplegar.
