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
| Meta (WhatsApp) | Plantillas y mensajes cobrados | Lo que **reporta Meta** del mes (días UTC, sin IVA; docs/meta-whatsapp.md). Sin esa lectura, el **estimado del CRM** (abajo) |

El correo también trae una línea del **ahorro por contestar desde el celular o WhatsApp Web** (docs/meta-whatsapp.md; no suma al total), el **total**, las **ventas del mes** (contactos que hoy están en la etapa de venta y entraron
a ella en el mes, sin los de prueba) y el **costo del CRM por venta**. Si un servicio no tiene dato, sale «sin dato» y
el total dice que va sin él.

**En pesos** (decisión del dueño 28-oct-2026): cada monto sale en pesos y, abajo en gris, en dólares, con el
**promedio del dólar del mes** que publica el Diario Oficial de la Federación (FIX; API pública de SIDOF, indicador
158, sin llave ni registro; la de Banxico pide token): `lib/costos/tipo-cambio.ts`. Una línea al final dice a cuánto
quedó el dólar. Si el Diario Oficial no responde, el correo sale igual, solo en dólares, con un aviso.

**Nota de una sola vez:** `NOTAS_DEL_MES` en `lib/costos/mes.ts`. Octubre de 2026 (correo del 3-nov) explica que es el
primer mes completo, que no hay mes anterior para comparar y que salió alto por pruebas y ajustes. Sin pie de texto
(el dueño lo quitó por ser demasiada explicación).

**Fuera, por decisión del dueño:** suscripciones con las que se construye el CRM (Claude, ChatGPT/Codex), la
publicidad en Meta, las guías de Envia y el dominio. No son costo de tener el CRM funcionando.

Para IA se usa lo que cobró el proveedor y no lo que calcula el CRM: en Anthropic el CRM calcula ~12 % de más
(informe del primer mes) y la tarjeta del Dashboard toma el mayor de los dos. Incluye lo de pruebas (staging).

Meses: los proveedores cobran por día UTC y así se suman; las ventas y los mensajes de Meta se cuentan con el mes
en hora de Mazatlán.

### Meta

Desde el 4-nov-2026 el renglón usa **lo que reporta Meta** del mes (`meta_whatsapp_pricing`, lo lee el worker cada hora
de Zernio; docs/meta-whatsapp.md), solo si la última lectura es de después de que cerró el mes. Meta cobra el día 1 a la
tarjeta, en dólares y **sin IVA**: octubre de 2026 = US$44.16 (el correo del 3-nov dijo US$49.06 con el estimado).

**Estimado (respaldo)** — `lib/costos/meta-estimado.ts`, solo para un mes sin esa lectura. Cuenta de más (~14 %: 3,403
contra 2,985 en octubre), porque Meta a veces da más tiempo gratis por anuncio que las 72 h del CRM:

- Solo WhatsApp, sin canales de prueba, sin lo importado ni lo mandado desde el celular, solo lo entregado o leído.
- Gratis 72 h desde la primera respuesta (≤ 24 h) a un cliente que llegó por un anuncio.
- Plantillas de marketing y de utilidad según su categoría; mensajes normales (servicio) después de los primeros
  1,000 del mes por número (Meta los cobra desde el 1-oct-2026).
- Tarifas: lo que cobró Meta por mensaje en octubre de 2026, sin IVA: marketing US$0.0407, utilidad US$0.0084, normal
  US$0.0115 (con los mensajes que Meta cobró en octubre dan US$44.19 contra US$44.16 de la factura). Las de antes
  (0.0431/0.0108/0.0105 «con IVA») salieron de una cifra equivocada del asistente de Meta. Si Meta cambia sus tarifas,
  se cambian en `META_TARIFAS_USD`, en `META_RATE_USD` (lib/meta-whatsapp/rates.ts) y aquí.

El monto de la factura sigue en Meta Business Suite › Facturación y pagos › Cuentas › «Cuentas de mensajes».

## Dashboard › Costo del CRM

Desde el 20-nov-2026 (pedido del dueño: «el monto mensual y total del mantenimiento del CRM») el Dashboard muestra
hasta arriba la tarjeta **Costo del CRM** con la misma lista fija de arriba (mapa del CRM 3.1 › 115–118):

- **Va**: lo que llevan este mes, días UTC. IA = el gasto del mes de la tarjeta Gasto de IA; Meta = lo que reporta
  del mes; Zernio = lo que va cobrado; Railway = el uso de su periodo actual, nunca menos de lo que cuesta el plan
  (US$5 en Hobby, se cobra igual). Railway cobra del 5 al 5: los días 1 a 4 todavía es el periodo del mes anterior.
- **Cierre estimado**: IA con el promedio de los últimos 7 días (la misma proyección del Historial del gasto de IA),
  Railway y Zernio con su factura estimada, Meta con lo que va llevado al mes completo. El primer día no se calcula.
- **Mes pasado**: sale de la tabla `crm_cost_months` (migración 0081), una fila por mes cerrado y organización. Hace
  falta porque Railway y Zernio solo guardan su periodo actual (y Zernio el anterior): sin la tabla, los meses pasados
  se perderían. Sin total acumulado (21-nov-2026, dueño): cada mes se ve por separado.
- **Historial de costos** (botón de la tarjeta, `/inicio/costos`, mapa 3.1.4): el correo de este documento, en vivo, para
  el mes en curso y para cada mes guardado (`lib/costos/historial*.ts`, mismo `htmlCorreo`).

**Quién llena la tabla:** el worker, cada hora (`lib/costos/guardar-mes.ts`), guarda el **mes anterior** con las
mismas reglas de este correo (Railway = el periodo que EMPIEZA en ese mes; Zernio = su mes anterior ya cerrado; Meta =
lo que reportó, solo si se leyó después del cierre). Los primeros **7 días** del mes siguiente (hora de Mazatlán) lo
vuelve a calcular, porque Railway cierra el 5 y los proveedores tardan en reportar; un dato que ya no se puede leer
(null) no borra el que ya estaba; después del día 7 queda fijo. No llama a ningún proveedor.

**Meses de antes de la tabla:** cargados a mano el 21-nov-2026 con `source = 'manual'` (el worker nunca los toca),
verificados con las facturas: septiembre US$10.03 (IA 9.18 Anthropic + 0.85 OpenAI; Meta, Railway y Zernio en 0:
Railway en prueba gratis y el crédito de Zernio cubrió la cuenta) y octubre US$99.97 (IA 41.02, Meta 44.16 = cargo a la
tarjeta del 1-nov, Railway 13.74 = factura del periodo 5-oct → 5-nov, Zernio 1.05). Respaldo de antes en las notas. Para corregir un mes: actualizar su fila y
ponerle `source = 'manual'`.

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
  lee la base, `meta-estimado.ts`, `tipo-cambio.ts`, `correo.ts` el HTML, `zoho.ts` el envío).

### ¿Cuesta algo?

No (revisado el 28-oct-2026):
- **GitHub:** el repo es público y corre en una máquina estándar de GitHub (`ubuntu-24.04`): gratis, sin tope de
  minutos. Una corrida al mes de ~2–3 min.
- **Zoho:** la API de Zoho Mail viene con el plan gratis; es un correo al mes desde la cuenta que ya existe.
- **Railway:** no hay servicio nuevo. Lee la base que ya existe una vez al mes por el mismo acceso de los respaldos;
  la consulta tarda segundos y la respuesta pesa unos KB (la salida de datos de Railway cuesta US$0.05 por GB: menos
  de una milésima de centavo).
- **IA:** no llama a ningún modelo. Las lecturas de cobro las hace el worker cada 5–15 min desde antes (no cambian).
- **Tipo de cambio:** el Diario Oficial lo publica gratis y sin registro.

### Conectar Zoho

Una sola vez (o si se revoca el acceso). El permiso es solo **crear y mandar correos** (`ZohoMail.messages.CREATE`).

1. En https://api-console.zoho.com con la cuenta de contacto@diluvium.com.mx (Zoho pide confirmar la contraseña: eso
   lo hace el dueño): **Add Client › Self Client › Create**.
2. **Generate Code**: scope `ZohoMail.messages.CREATE`, duración 10 minutos, descripción «Correo mensual de costos del
   CRM» → **Create**.
3. Con los botones **COPY** de Zoho (código, Client ID y Client Secret, uno por uno; nunca leyendo la página) y
   `notas/costos-correo/conectar-zoho.sh` en `~/Documents/Diluvium CRM/`: `id`, `secreto` y `codigo` leen el
   portapapeles; `codigo` lo cambia por el *refresh token* (`POST https://accounts.zoho.com/oauth/v2/token`,
   `grant_type=authorization_code`); `fijos <correo-destino>` pone `ZOHO_ACCOUNT_ID` y `COSTOS_CORREO_PARA`. Todo queda en
   el environment `production-backup` de GitHub y en `~/Documents/Diluvium CRM/llaves/llaves-crm.md`. El refresh token
   no caduca. (El modo `archivo` sirve si Zoho deja bajar `self_client.json`; el navegador integrado no lo baja.)

Hecho el 28-oct-2026 (Self Client «Diluvium México»; acceso comprobado y correo de prueba entregado).

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
- Revisar sin mandar: Actions › costos-mes › Run workflow con «Solo verificar» (lee la base, el tipo de cambio y el
  acceso a Zoho; el log dice si todo está bien, sin montos).
- Mandarlo otra vez: Actions › costos-mes › Run workflow (vacío = el mes anterior, o `AAAA-MM`). Railway y Zernio
  solo guardan el periodo actual y el anterior: un mes viejo sale con «sin dato» en esos renglones.
- Cambiar a quién le llega: `gh secret set COSTOS_CORREO_PARA --env production-backup`.
