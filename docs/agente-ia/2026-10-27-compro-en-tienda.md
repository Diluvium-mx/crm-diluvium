> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Compró en Amazon o Mercado Libre: el lector lo anota (27-oct-2026, migración 0074)

Pedido del dueño: pedir reseña en Amazon y Mercado Libre a quien dijo en el chat que ya compró ahí, con el menor gasto
de IA posible. Diseño completo en `docs/opiniones.md` § 7; pantalla en el mapa 3.11 › 22–32.

- **Sin llamada nueva al modelo.** La lectura en segundo plano (Luna, `lib/ai/runtime/lector-core.ts`) ya leía todo el
  chat y ya distinguía «ya compró en otro lado» para el caso `no_seguir` del seguimiento. Ahora la ficha base (en TODAS
  las lecturas, no solo las de seguimiento) trae `compro_en: amazon | mercado_libre | null`: solo si el cliente YA compró
  o pidió la compuerta ahí (lo dice él o la empresa confirma su pedido de esa tienda); no si pregunta por esas tiendas,
  pide el enlace o dice que la va a comprar ahí. Costo: un renglón más en las instrucciones (en caché) y unos tokens de
  salida.
- **Candado en el código** (como «montos nunca inventados»): `compro_en` solo vale si un mensaje del **cliente** nombra
  esa tienda (`lib/resenas-tienda/tiendas.ts`: Amazon; Mercado Libre, MercadoLibre, ML o meli; sin acentos ni
  mayúsculas). Los mensajes de la empresa no cuentan: el workflow de información y el Agente IA nombran las dos tiendas
  al dar las opciones de compra. Si no, va a `ignored` («el cliente nunca nombra … en el chat»).
- **Se guarda** en `resenas_tienda` (una fila por contacto) con la frase del cliente que nombra la tienda (la última,
  calculada en código, sin IA). Si ya estaba «por pedir» con otra tienda, se cambia; pedida, contestada o descartada
  por un vendedor («No compró ahí»), no se toca. Cuenta en `cambios` como `compro_en <tienda>` (`ai_usage.error`).
- **Ficha guardada:** «Compró en otra tienda: ninguna / Amazon / Mercado Libre / no (lo corrigió un vendedor)», para
  que no lo vuelva a mandar.
- **Seguimiento: «ya compró en otro lado» también en el código.** Si el contacto tiene tienda anotada (y un vendedor no
  la descartó), la ficha de seguimiento que arme el lector queda en `no_seguir` («Ya compró la compuerta en Amazon.»),
  sin borrador. Así, después de «Pedir reseña» (el último mensaje queda nuestro) no le sale un seguimiento de venta
  aunque el modelo se equivoque. Antes solo estaba en las instrucciones.
- No cambia el Goal, las FAQs ni la etapa.
- Pruebas: `lector-core.test.ts` (candado), `lector.int.test.ts` (anota, ficha, descarta), `lib/resenas-tienda/*.test.ts`.
