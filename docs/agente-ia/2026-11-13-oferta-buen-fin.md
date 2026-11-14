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
- ~~Con la oferta la tarjeta es de contado~~ (13-nov). **Desde el 14-nov:** con la oferta **sí hay meses sin intereses con
  tarjeta de crédito**, sin decir cuántos (aunque el Goal diga «hasta 6» y la lista de links también); de contado con
  crédito o débito con el mismo link.
- ~~La web y Amazon sí, Mercado Libre todavía no~~ (13-nov). **Desde el 14-nov:** la oferta está en la página web (ahí sí
  dice $5,199, es nuestra tienda), en Amazon y en Mercado Libre (de esas dos solo «también está en oferta», nunca su
  precio). Las menciona **solo si** el cliente pregunta dónde más comprar o por una de ellas, o si duda de pagar por
  WhatsApp (desconfía, teme un fraude): entonces, sin presionar, le ofrece comprar ahí con la oferta.
- No dice por su cuenta que la oferta es solo de la estándar. Si preguntan por la hecha a la medida, la mini, los tapones
  inflables (14-nov) o un repuesto (funda, tira de hule): con amabilidad, la oferta es de los tamaños estándar y eso sigue
  con su precio (la hecha a la medida, anticipo y el resto al estar fabricada).
- 14-nov: si alguien que compró antes del 13 pide que le regresen la diferencia: un asesor lo revisa con él, aviso al
  vendedor (`cliente_pide_humano`, detalle «pide la diferencia del Buen Fin») y no promete nada.
- 2 o más compuertas (dueño, 14-nov: se queda como está): el total va a $5,199 cada una ($10,398 y $15,597) y el link de
  ese total lo manda el vendedor (o su precio especial; el de 3 es $15,000, más bajo).

**Después del 18 (14-nov, decisión del dueño).** Del 19-nov 00:00 al 25-nov 23:59:59 sale otro aviso,
`BUEN_FIN_TERMINO_LINE`: la oferta terminó, la compuerta vuelve al precio del Goal y ya no se usa $5,199 en totales ni
cotizaciones. Si en el chat se dio el precio de oferta y el cliente quiere pagar, le dice con amabilidad que terminó el
18, le da el precio de siempre y avisa al vendedor por si se le respeta (sin prometerlo); si en el chat no se habló de la
oferta, no la menciona. El 26-nov ya no sale nada.

**Pruebas con los modelos reales (13-nov, pedido explícito del dueño).** Simulador fuera del repo con el Goal, las FAQs,
las herramientas y los links de producción (lectura con `default_transaction_read_only=on`) y los dos modelos (Luna y
Sonnet 5.5): 32 casos de precio y objeciones, cuatro rondas (194 respuestas, ≈ US$1.20 con las tarifas de lib/ai/pricing.ts: Sonnet 5.5 ≈ 1.14 y Luna ≈ 0.07). Lo que se corrigió entre rondas:
ofrecía 6 MSI con el precio de contado, decía «no sé el precio en Amazon», Luna inventó el precio de Amazon, «no puedo
compartir el precio anterior», ofrecía «apartar» y repetía la fecha límite. En la última ronda: nunca el precio normal,
ni «gran descuento», ni la fecha vieja. Luna a veces contesta vacío (también sin el aviso: ya pasaba; en producción
contesta el otro modelo).

**Fuera del código (en producción, con OK del dueño).**
- Workflows «Información» y «Precio 2»: el texto «Ahorita tenemos cualquier tamaño en $5,500 con envío gratis» cambia a
  «Ahorita tenemos todos los tamaños en oferta por el Buen Fin, del 13 al 18 de noviembre, por tan solo $5,199 con envío
  gratis.» (aplicado en producción el 13-nov) (los workflows no están en la caché: no cuesta). **El 19-nov se regresa** al texto de antes.
- Links de pago: «1 compuerta estándar (Buen Fin)» de $5,199 (link del dueño; cargado el 13-nov, posición 14). **14-nov,
  con OK ESCRITURA PROD:** su link de contado (mpago.li/1SYhpks) se cambió por uno **a meses** del dueño
  (mpago.la/1d3SxjV, `meses` 6; misma fila; respaldo en notas/buen-fin/respaldo-links-pago-2026-11-14.tsv y fila del
  Historial). Cambiar los links es el bloque 2 de la
  caché (~US$0.025 al cargarlo y otro tanto al quitarlo). **El 19-nov se quita.** Con 2 o más compuertas no hay link de
  oferta: el candado del total manda el aviso al vendedor para que lo mande él.

**Al terminar.** El código se quita junto con la columna Buen Fin (`ETAPAS_FUERA_DEL_AGENTE`); mientras tanto no hace
nada fuera de las fechas (el aviso «ya terminó» se apaga solo el 26-nov). Pruebas: `buen-fin-oferta.test.ts` (fechas de
inicio, fin y «ya terminó», sin «$5,500» ni «$5,999», meses sin número, reglas del dueño).
