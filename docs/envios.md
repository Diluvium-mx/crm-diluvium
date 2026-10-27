# Guías de envío con Envia.com

> Fase 1, construida el 27-oct-2026 (rama `feature/guias-envia`, migración 0075). Pantalla: Bandeja › Detalle del
> contacto › **Envío** (mapa 3.2.3 › 37–47). Análisis y diseño previos (fuera del repo):
> `~/Documents/Diluvium CRM/reportes/guias-envia/`.

## Qué es

El vendedor hace la guía de Paquetexpress o Estafeta **desde el Detalle del contacto**, sin copiar la dirección al panel
de Envia ni el rastreo de regreso al chat. Se cobra del mismo saldo prepagado de Envia (la API no cuesta extra).

Decisiones del dueño (26-oct-2026):

- **Envia es el único servicio nuevo** para envíos (excepción a la regla de servicios del CRM), con la condición de
  cambiar poco la interfaz: una sección al final del Detalle y una ventana.
- **No se imprime solo** (la impresora se prende a mano): basta con que cada guía salga con el formato de su
  paquetería ya definido.
- Mercado Libre, Amazon y Shopify **no** se conectan al CRM en esta fase. Amazon Easy Ship se sigue imprimiendo a mano.

## Reglas fijas (decisión del dueño, 27-oct-2026)

- **Datos del cliente que se piden:** nombre completo, teléfono, calle, número, código postal, colonia, ciudad y
  estado. Sin correo ni referencias.
- **Origen:** siempre la oficina de Los Mochis, tal como está guardada en Envia (con su RFC y referencia).
- **Una guía por compuerta**, con el embalaje guardado de su talla (tipo «Caja»).
- **Paquetexpress puerta a puerta** es la de siempre (recoge en la oficina y entrega a domicilio), aunque cueste
  unos pesos más. Si Paquetexpress no llega, es zona extendida o ninguna da precio → aviso para que el vendedor elija.
- **Cada guía:** valor declarado **$4,000** y la nota interna (`settings.comments`) **«Compuerta
  Anti-Inundaciones»**. Sin seguro, sin servicios adicionales y sin programar recolección.

## Cómo funciona

1. **Hacer guía** abre la ventana llena con lo que ya sabe el CRM: nombre y teléfono (10 dígitos) del contacto o la
   dirección de su última guía, y una compuerta por entrada del Detalle con el embalaje de su talla.
2. El **código postal** se busca en Envia (geocodes): estado (código de 2 letras de Envia, p. ej. Sinaloa = `SI`),
   ciudad y colonias.
3. **Cotizar** pide precio a Paquetexpress y Estafeta en paralelo, una llamada por paquetería y por compuerta (Envia
   cotiza una paquetería por llamada); cada opción suma las guías. Cada paquetería da su servicio puerta a puerta
   (`ground`, `express`) y las variantes «Ocurre» (`_od`: sucursal a puerta; `_do`: puerta a sucursal), con el texto de
   Envia (`dropOffDescription`) y el cargo de zona extendida (`extendedFare`). Viene marcada Paquetexpress puerta a
   puerta (`lib/envios/messages.ts` › `preferredOptionIndex`); `reviewReason` dice cuándo hay que avisar al vendedor.
4. **Generar guía por $X** (una por compuerta, en orden):
   - Cada guía se apunta ANTES de pedirla con su llave (`<llave de la ventana>:<n>`, única por organización): un
     doble clic o un reintento no genera ni cobra otra.
   - Error de Envia → esa fila queda `fallida` con el mensaje tal cual y ya no se piden las siguientes. El reintento
     salta las creadas y vuelve a pedir la fallida en su misma fila (con los datos corregidos).
   - Guía creada → la fila queda `creada` en seguida (ya se cobró) y después se guardan en el bucket el PDF de Envia y
     la copia lista para imprimir (`org/{org}/envios/{id}/guia-envia.pdf` y `guia-imprimir.pdf`). Si el bucket falla,
     la guía sigue creada y `/api/envios/{id}/guia` arma la copia al primer clic desde la liga de Envia.
5. **Poner rastreo en el chat** deja el texto en la caja del chat sin mandarlo (FAQ 55: se manda cuando sale a ruta).
   Sin caja a la vista (pop-up del Embudo o chat fuera de las 24 h) lo copia.
6. **Cancelar guía** la cancela en Envia (regresa el dinero si no se escaneó; puede tardar días). Solo una `creada` y con
   la misma cuenta de Envia con la que se hizo (`environment`).

Origen: la **dirección favorita de origen guardada en Envia**; si no hay favorita, la del código postal de
`ENVIA_ORIGEN_CP`; si no, la única que haya. La cuenta real (27-oct-2026) tiene 5 orígenes (Los Mochis, Ocoyoacac,
Mexicali, San Pedro Garza García y CDMX) y ninguno es favorito: por eso `ENVIA_ORIGEN_CP=81200`. Embalajes: los **guardados en
Envia** (se leen cada vez; si se cambian allá, el CRM los ve). Talla → embalaje (`lib/envios/form.ts`): XCH → Compuerta
Extra Chica, CH → Chica, M → Mediana, G → Grande, XG → Extra Grande; mini y a la medida las elige el vendedor.

Ver las guías = permiso de leer el contacto; hacerlas o cancelarlas = editarlo (vendedor incluido). Borrar el contacto
(ARCO) se lleva sus guías (cascade) y su carpeta del bucket.

## Impresión (formato por paquetería)

Impresora de la oficina: HP LaserJet Professional P1606dn (láser, carta). Hoy, desde el PDF de Envia:

| Paquetería | Lo que se imprimía a mano | Lo que guarda el CRM (`lib/envia/print-profiles.ts`) |
|---|---|---|
| Paquetexpress | PDF de 3 hojas 4x6: solo la 3, escala 100 % | La **última** hoja, en hoja carta, tamaño real y centrada |
| Estafeta | 1 hoja 4x6, escala 100 % | Su hoja, en hoja carta, tamaño real |
| Otra | — | Todas sus páginas, en carta |

Como la hoja ya es carta y la guía ya va a 100 %, el diálogo de impresión da lo mismo: se elige la HP e Imprimir.
Se toma la ÚLTIMA página (no «la 3») para que siga saliendo la guía si Envia algún día la manda en una sola hoja. Una
página apaisada va en carta horizontal; solo se reduce si no cabe. Si pdf-lib no puede acomodar una página, se copia tal
cual. A Envia se le pide `printFormat: PDF`, `printSize: STOCK_4X6`: en la cuenta real Paquetexpress y Estafeta solo
ofrecen 4x6 (el de omisión) o 7x4.75; carta no existe.

**Verificado el 27-oct-2026 sin gastar** (guías ya hechas en la cuenta real, `GET queries…/guide/{MM}/{AAAA}`): el PDF
de Paquetexpress trae 3 hojas 4x6 y la guía es la 3; el de Estafeta, 1 hoja 4x6. El CRM saca una hoja carta con la
guía a tamaño real en los dos.

## Variables y ambientes

| Variable | Staging | Producción |
|---|---|---|
| `ENVIA_API_TOKEN` | Token de la **cuenta de pruebas** de Envia (shipping-test.envia.com, cuenta aparte; guías falsas sin costo) | Token de la cuenta real (Desarrolladores › Acceso de API) |
| `ENVIA_ENV` | `sandbox` (o `production` con la cuenta real, ver abajo) | `production` |
| `ENVIA_GENERAR` | sin poner (con la cuenta real: solo cotizar) | `si` (se pone en el OK MAIN) |
| `ENVIA_ORIGEN_CP` | `81200` | `81200` (la oficina de Los Mochis, mientras en Envia no haya origen favorito) |

- **Candado del saldo** (27-oct-2026, pedido del dueño: «no gastes ni un peso»): con la cuenta real (`ENVIA_ENV=production`)
  el servidor **solo genera guías si `ENVIA_GENERAR=si`**; sin eso, lee y cotiza (no cobra) y la ventana dice «Solo
  cotizar». Dos barreras: `createShipment` se niega antes de apuntar la fila y el cliente (`generate`) se niega sin
  llamar a Envia. La cuenta de pruebas siempre genera (no cobra). Staging usa la cuenta real con el candado cerrado.
- El token **no caduca y no se puede limitar** (cualquier token puede gastar saldo): solo en las variables de Railway,
  cargado con `railway variables … --stdin` desde el portapapeles; nunca en el repo ni en el chat.
- Sin las dos variables la sección dice «Envia no está configurado» y no deja hacer guías.
- URLs (`lib/envia/config.ts`): pruebas `api-test.envia.com` y `queries.test.envia.com`; producción `api.envia.com` y
  `queries.envia.com`; geocodes solo existe en producción y no pide token.
- Una guía de pruebas lleva la etiqueta **Prueba** y no se puede cancelar con el token real (ni al revés).

## Trampas de la API de Envia (docs.envia.com, revisado el 26-oct-2026)

- Algunos errores llegan con **HTTP 200 y `"meta": "error"`**: el cliente revisa `meta` en cada respuesta.
- `totalPrice` llega como texto al cotizar y como número al generar.
- 402 = sin saldo; 401/403 = token rechazado (los dos se dicen así en la UI).
- La etiqueta llega como **liga** (S3 o envia.com); no se sabe si caduca: por eso se guarda en el bucket al generarla.
  Se baja con `safeFetch` y solo de `envia.com` o `amazonaws.com`.
- El formato de la dirección de origen guardada no está documentado: se lee de forma tolerante (camelCase o snake_case)
  y se marca la favorita por `is_favorite`/`favorite`/`is_default`.

## Pendiente (fuera de la Fase 1)

1. **Rastreo en vivo** (webhooks de Envia v2 firmados, tipos tracking y sobrepeso): estado en el Detalle, aviso al
   cliente al entregarse y, después, la Opinión postventa.
2. **Plantilla de Meta «su guía es…»** (utilidad) para mandar el rastreo fuera de las 24 h (las hechas a la medida salen
   ~3 semanas después de la venta). Se le muestra al dueño antes de mandarla a revisión.
3. **Pedidos de las tiendas** (Shopify, Mercado Libre ME1) por `GET queries.envia.com/v4/orders`, cuando se conecten en
   Envia › Ecommerce Pro.
4. Impresión directa a la HP (está en red, AirPrint) con un programa en la Mac de la oficina, si algún día se quiere sin
   diálogo.
