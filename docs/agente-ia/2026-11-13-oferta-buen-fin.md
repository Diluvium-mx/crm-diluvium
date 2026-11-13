> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Oferta del Buen Fin en el Agente IA: aviso temporal que se apaga solo (13-nov-2026, sin migración)

**Pedido del dueño (13-nov).** Del 13 al 18 de noviembre (el dueño la alargó un día el 13-nov: termina el 19 a las 00:00) la compuerta estándar está
en oferta por el Buen Fin en **$5,199** (el mismo precio de la página web; en Amazon también, en Mercado Libre todavía no). El Agente IA tiene que
decirlo cuando pregunten el precio, sin tocar el Goal ni otra instrucción, porque solo son cuatro días.

**Por qué no en el Goal ni en una FAQ.**
- El Goal está en el bloque 1 de la caché: cambiarlo cuesta la reescritura completa (~US$0.11) al ponerlo y otra al
  quitarlo, y solo después de las 22:00.
- Una FAQ va en el bloque 2 (~US$0.025 por cambio desde el 11-nov), pero el modelo no recibe la fecha de hoy: alguien
  tendría que acordarse de apagarla el 17. Además el Goal dice en cuatro partes «$5,500» y «no manejamos descuentos», y
  una FAQ a media instrucción puede perder contra eso.

**Qué hace.** `buenFinOfertaLine(now)` (`lib/ai/runtime/buen-fin-oferta.ts`) agrega una línea al
`[CONTEXTO DEL CRM]` del último mensaje del cliente (`run.ts`, junto a la etapa, la cotización y el Detalle) **solo del
13-nov 00:00 al 18-nov 23:59:59 hora de Mazatlán** (las fechas del temporizador de la columna). Esa parte no está en la
caché: **no cuesta reescritura** y el 19-nov a las 00:00 deja de salir sin que nadie haga nada. Va a los dos modelos
(Luna y Sonnet) y a todos los chats, no solo a los de la columna Buen Fin.

**Reglas del aviso (dueño, 13-nov; afinadas con las pruebas del mismo día).**
- Dice siempre solo la cifra de oferta ($5,199); nunca menciona, compara ni recuerda el precio normal ni cuánto se ahorra.
  Si preguntan cuánto costaba antes o si es el precio normal, contesta solo que ahorita está en $5,199 por la oferta (sin
  decir que «no puede compartirlo»).
- Las fechas van una sola vez: la primera vez que da el precio, como oferta por el Buen Fin, del 13 al 18 de noviembre; si
  en el chat ya se dijo (los workflows «Información» y «Precio 2»), no las repite ni al dar un total, salvo que pregunten
  hasta cuándo. Solo si preguntan por pagar después o apartar: vale pagando a más tardar el 18; sin apartados.
- No presume el descuento; solo si el cliente dice que es el mismo precio o que no cambia mucho, le dice con amabilidad
  que sí es un descuento considerable por el Buen Fin.
- Si pide descuento o se le hace caro: ese ya es el precio de oferta y «no manejamos otro descuento».
- Totales y `fijar_cotizacion` con $5,199 por compuerta estándar (si un vendedor ya fijó la cotización, esa manda).
- Con la oferta la tarjeta es **de contado** (link de $5,199, `meses` 0): no ofrece meses sin intereses en la estándar; si
  preguntan, el precio de oferta es de contado.
- La página web también está en $5,199 y Amazon también tiene oferta (sin decir su precio); Mercado Libre todavía no (ahí
  contesta lo de siempre del Goal).
- No dice por su cuenta que la oferta es solo de la estándar. Si preguntan por la hecha a la medida, la mini o un repuesto
  (funda, tira de hule): con amabilidad, la oferta es de los tamaños estándar y eso sigue con su precio (la hecha a la
  medida, anticipo y el resto al estar fabricada).

**Pruebas con los modelos reales (13-nov, pedido explícito del dueño).** Simulador fuera del repo con el Goal, las FAQs,
las herramientas y los links de producción (lectura con `default_transaction_read_only=on`) y los dos modelos (Luna y
Sonnet 5.5): 32 casos de precio y objeciones, cuatro rondas (~190 respuestas, ≈ US$1.5). Lo que se corrigió entre rondas:
ofrecía 6 MSI con el precio de contado, decía «no sé el precio en Amazon», Luna inventó el precio de Amazon, «no puedo
compartir el precio anterior», ofrecía «apartar» y repetía la fecha límite. En la última ronda: nunca el precio normal,
ni «gran descuento», ni la fecha vieja. Luna a veces contesta vacío (también sin el aviso: ya pasaba; en producción
contesta el otro modelo).

**Fuera del código (en producción, con OK del dueño).**
- Workflows «Información» y «Precio 2»: el texto «Ahorita tenemos cualquier tamaño en $5,500 con envío gratis» cambia a
  «Ahorita tenemos todos los tamaños en oferta por el Buen Fin, del 13 al 18 de noviembre, por tan solo $5,199 con envío
  gratis.» (aplicado en producción el 13-nov) (los workflows no están en la caché: no cuesta). **El 19-nov se regresa** al texto de antes.
- Links de pago: «1 compuerta estándar (Buen Fin)» de $5,199, de contado (link del dueño; cargado el 13-nov, posición 14). Cambiar los links es el bloque 2 de la
  caché (~US$0.025 al cargarlo y otro tanto al quitarlo). **El 19-nov se quita.** Con 2 o más compuertas no hay link de
  oferta: el candado del total manda el aviso al vendedor para que lo mande él.

**Al terminar.** El código se quita junto con la columna Buen Fin (`ETAPAS_FUERA_DEL_AGENTE`); mientras tanto no hace
nada fuera de las fechas. Pruebas: `buen-fin-oferta.test.ts` (fechas de inicio y fin, sin «$5,500» ni «$5,999», reglas del dueño).
