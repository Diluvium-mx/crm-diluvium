# Costos del CRM y correo mensual

Decisión del dueño (28-oct-2026): definir **de una vez** qué se cuenta como costo del CRM y recibirlo por correo
el **día 3 de cada mes**, sin pedirlo. Base: el informe del primer mes (Notion «Gastos CRM Sep/Oct», 27-oct-2026).

## Qué se cuenta (lista fija)

| Servicio | Para qué es | De dónde sale el número |
|---|---|---|
| IA · Anthropic | Agente IA (Sonnet) | Lo que **cobró** Anthropic (`ai_provider_billing`, lo lee el worker cada 5 min) |
| IA · OpenAI | Agente IA (Luna) y notas de voz | Lo que **cobró** OpenAI (igual) |
| IA · xAI, OpenRouter, Google | Modelos de reserva | Solo salen si ese mes gastaron algo. Google no da su cobro: se usa lo que registró el CRM y el correo lo dice |
| Railway | Servidores del CRM | `railway_billing` (docs/railway-costos.md). Su periodo va **del 5 al 5**: el reporte de un mes lleva el periodo que empieza ese mes, y como el día 3 aún no cierra sale la **factura estimada** (plan + uso proyectado al corte) |
| Zernio | Conecta WhatsApp e Instagram | El mes anterior de Zernio (`zernio_billing`, docs/zernio-costos.md); el día 3 ya está cerrado |
| Meta (WhatsApp) | Plantillas y mensajes cobrados | **Estimado del CRM** con IVA (abajo), mientras Meta no le dé su cobro al CRM |

El correo también trae el **total**, las **ventas del mes** (contactos que hoy están en la etapa de venta y entraron
a ella en el mes) y el **costo del CRM por venta**. Si un servicio no tiene dato, sale «sin dato» y el total dice
que va sin él.

**Fuera, por decisión del dueño:** suscripciones con las que se construye el CRM (Claude, ChatGPT/Codex), la
publicidad en Meta, las guías de Envia y el dominio. No son costo de tener el CRM funcionando.

Para IA se usa lo que cobró el proveedor y no lo que calcula el CRM: en Anthropic el CRM calcula ~12 % de más
(informe del primer mes) y la tarjeta del Dashboard toma el mayor de los dos. Incluye lo de pruebas (staging).

Meses: los proveedores cobran por día UTC y así se suman; las ventas y los mensajes de Meta se cuentan con el mes
en hora de Mazatlán.

### Meta (estimado)

`lib/costos/meta-estimado.ts`, con las reglas que se revisaron mensaje por mensaje contra Meta el 27-oct-2026
(coincidieron en el 97 % de los mensajes y en el total de cobrables):

- Solo WhatsApp, sin canales de prueba, sin lo importado ni lo mandado desde el celular, solo lo entregado o leído.
- Gratis 72 h desde la primera respuesta (≤ 24 h) a un cliente que llegó por un anuncio.
- Plantillas de marketing y de utilidad según su categoría; mensajes normales (servicio) después de los primeros
  1,000 del mes por número (Meta los cobra desde el 1-oct-2026).
- Tarifas por mensaje cobrado, con el IVA ya incluido (oct-2026): marketing US$0.0431, utilidad US$0.0108, servicio
  US$0.0105. Calibradas con el cobro real de Notion «Gastos CRM Sep/Oct»: los 2,498 mensajes cobrables del 22-sep al
  23-oct (312 de marketing, 47 de utilidad, 2,139 de servicio) dan US$36.41 contra US$36.25 con IVA que cobró Meta
  (0.5 % arriba). Sumarles otro 16 % daba US$42.24, de más. Si Meta cambia sus tarifas, se cambian en
  `META_TARIFAS_USD` y aquí.

El monto exacto sigue en Meta Business Suite › Facturación y pagos. Cuando entre `feat/meta-costos` (falta el token
de Meta), el renglón pasa a usar lo que reporta Meta.

## El correo

- GitHub lo manda el **día 3 a las 9:00 de Mazatlán** (`.github/workflows/costos-mes.yml`) con el mes calendario
  anterior. No sale de Railway porque el plan Hobby bloquea el correo (SMTP).
- Lee la base con la URL de **solo lectura** de los respaldos (`PROD_DATABASE_URL`, rol `backup_ro`, TLS
  verify-ca) y además abre la sesión en solo lectura. No llama a ningún proveedor: usa lo que ya guardó el worker.
- Sale de **contacto@diluvium.com.mx** por la **API de Zoho Mail**. La cuenta es del plan gratis de Zoho (sin
  IMAP/POP), por eso no va por SMTP.
- Llega al correo que eligió el dueño: secret `COSTOS_CORREO_PARA` del environment `production-backup` (el repo es
  público: el correo no se escribe aquí).
- Código: `scripts/costos-mes.ts` (`npm run costos:correo`) y `lib/costos/` (`mes.ts` arma los renglones, `cargar.ts`
  lee la base, `meta-estimado.ts`, `correo.ts` el HTML, `zoho.ts` el envío).

### ¿Cuesta algo?

No (revisado el 28-oct-2026):
- **GitHub:** el repo es público y corre en una máquina estándar de GitHub (`ubuntu-24.04`): gratis, sin tope de
  minutos. Una corrida al mes de ~2–3 min.
- **Zoho:** la API de Zoho Mail viene con el plan gratis; es un correo al mes desde la cuenta que ya existe.
- **Railway:** no hay servicio nuevo. Lee la base que ya existe una vez al mes por el mismo acceso de los respaldos;
  la consulta tarda segundos y la respuesta pesa unos KB (la salida de datos de Railway cuesta US$0.05 por GB: menos
  de una milésima de centavo).
- **IA:** no llama a ningún modelo. Las lecturas de cobro las hace el worker cada 5–15 min desde antes (no cambian).

### Conectar Zoho

Una sola vez (o si se revoca el acceso). El permiso es solo **crear y mandar correos** (`ZohoMail.messages.CREATE`).

1. En https://api-console.zoho.com con la cuenta de contacto@diluvium.com.mx (Zoho pide confirmar la contraseña: eso
   lo hace el dueño): **Add Client › Self Client › Create**.
2. **Generate Code**: scope `ZohoMail.messages.CREATE`, duración 10 minutos, descripción «Correo de costos del CRM» →
   **Create** → **Download** (baja `self_client.json` con el Client ID, el Client Secret y el código).
3. `notas/costos-correo/conectar-zoho.sh archivo <ruta>/self_client.json <correo-destino>` (en `~/Documents/Diluvium
   CRM/`): cambia el código por el *refresh token* (`POST https://accounts.zoho.com/oauth/v2/token`,
   `grant_type=authorization_code`), guarda en el environment `production-backup` de GitHub `ZOHO_CLIENT_ID`,
   `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNT_ID` y `COSTOS_CORREO_PARA`, copia las llaves a
   `~/Documents/Diluvium CRM/llaves/llaves-crm.md` y **borra el archivo**. Nada pasa por el chat. El refresh token no
   caduca. (Sin el archivo: los modos `id`, `secreto`, `codigo` y `fijos` leen cada valor del portapapeles.)

Quitar el acceso: api-console.zoho.com › el Self Client › borrar (el correo deja de salir y abre la alerta).

### Probar en la Mac

```
DATABASE_URL=<base> COSTOS_MES=2026-10 npm run costos:correo -- --probar
```

`--probar` no manda nada: guarda el correo como HTML en la carpeta temporal y dice dónde. Sin `--probar` lo manda
(necesita las variables de Zoho y `COSTOS_CORREO_DE`/`COSTOS_CORREO_PARA`). Contra producción: solo con OK LECTURA
PROD y la URL de solo lectura.

### Si el correo no llega

- GitHub abre un issue con la etiqueta `alerta-costos` el mismo día (y lo cierra cuando vuelve a salir). La corrida
  dice el motivo en una línea, sin montos.
- «Zoho no dio acceso»: el refresh token se revocó o se borró el Self Client → repetir *Conectar Zoho*.
- «Zoho no mandó el correo»: el motivo viene de Zoho (p. ej. límite de envío del plan gratis).
- Mandarlo otra vez: Actions › costos-mes › Run workflow (vacío = el mes anterior, o `AAAA-MM`). Railway y Zernio
  solo guardan el periodo actual y el anterior: un mes viejo sale con «sin dato» en esos renglones.
- Cambiar a quién le llega: `gh secret set COSTOS_CORREO_PARA --env production-backup`.
