# Guías de envío con Envia.com

> Fase 1, construida el 27-oct-2026 (rama `feature/guias-envia`, migración 0075). Pantalla: Bandeja › Detalle del
> contacto › **Envío** (mapa 3.2.3 › 36–46). Análisis y diseño previos (fuera del repo):
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

## Cómo funciona

1. **Hacer guía** abre la ventana llena con lo que ya sabe el CRM: nombre y teléfono (10 dígitos) del contacto o la
   dirección de su última guía, una caja por entrada del Detalle con el embalaje de su talla y el valor declarado del
   Pago total (o del monto de cotización).
2. El **código postal** se busca en Envia (geocodes): estado (código de 2 letras de Envia, p. ej. Sinaloa = `SI`),
   ciudad y colonias.
3. **Cotizar** pide precio a Paquetexpress y Estafeta en paralelo (Envia cotiza una paquetería por llamada). La más
   barata va primero y marcada; si una falla, la otra sale igual con el porqué de la que falló.
4. **Generar guía por $X**:
   - La fila de `shipments` se apunta ANTES de pedir la guía con la llave de la ventana (`request_key`, única por
     organización): un doble clic o un reintento con la misma llave no genera ni cobra otra guía.
   - Error de Envia → fila `fallida` con el mensaje tal cual (se ve en la sección). El siguiente intento usa otra llave.
   - Guía creada → la fila queda `creada` en seguida (ya se cobró) y después se guardan en el bucket el PDF de Envia y
     la copia lista para imprimir (`org/{org}/envios/{id}/guia-envia.pdf` y `guia-imprimir.pdf`). Si el bucket falla, la
     guía sigue creada y `/api/envios/{id}/guia` arma la copia al primer clic desde la liga de Envia.
5. **Poner rastreo en el chat** deja el texto en la caja del chat sin mandarlo (FAQ 55: se manda cuando sale a ruta).
   Sin caja a la vista (pop-up del Embudo o chat fuera de las 24 h) lo copia.
6. **Cancelar guía** la cancela en Envia (regresa el dinero si no se escaneó; puede tardar días). Solo una `creada` y con
   la misma cuenta de Envia con la que se hizo (`environment`).

Origen: la **dirección favorita de origen guardada en Envia** (o la única que haya). Embalajes: los **guardados en
Envia** (se leen cada vez; si se cambian allá, el CRM los ve). Talla → embalaje (`lib/envios/form.ts`): XCH → Compuerta
Extra Chica, CH → Chica, M → Mediana, G → Grande, XG → Extra Grande; mini y a la medida las elige el vendedor.

Ver las guías = permiso de leer el contacto; hacerlas o cancelarlas = editarlo (vendedor incluido). Borrar el contacto
(ARCO) se lleva sus guías (cascade) y su carpeta del bucket.

## Impresión (formato por paquetería)

Impresora de la oficina: HP LaserJet Professional P1606dn (láser, carta). Hoy, desde el PDF de Envia:

| Paquetería | Lo que se imprimía a mano | Lo que guarda el CRM (`lib/envia/print-profiles.ts`) |
|---|---|---|
| Paquetexpress | PDF de 3 páginas: solo la 3, escala 100 % | La **última** página, en hoja carta, tamaño real y centrada |
| Estafeta | 1 página, escala 100 % | Su página, en hoja carta, tamaño real |
| Otra | — | Todas sus páginas, en carta |

Como la hoja ya es carta y la guía ya va a 100 %, el diálogo de impresión da lo mismo: se elige la HP e Imprimir.
Se toma la ÚLTIMA página (no «la 3») para que siga saliendo la guía si Envia algún día la manda en una sola hoja. Una
página apaisada va en carta horizontal; solo se reduce si no cabe. Si pdf-lib no puede acomodar una página, se copia tal
cual. A Envia se le pide `printFormat: PDF`, `printSize: PAPER_LETTER`.

**Por verificar con la cuenta de pruebas / la primera guía real:** que el PDF de Paquetexpress que da la API sea el
mismo de 3 páginas del panel (si la API la da en 1, el perfil sigue funcionando).

## Variables y ambientes

| Variable | Staging | Producción |
|---|---|---|
| `ENVIA_API_TOKEN` | Token de la **cuenta de pruebas** de Envia (shipping-test.envia.com, cuenta aparte; guías falsas sin costo) | Token de la cuenta real (Desarrolladores › Acceso de API) |
| `ENVIA_ENV` | `sandbox` | `production` |

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
