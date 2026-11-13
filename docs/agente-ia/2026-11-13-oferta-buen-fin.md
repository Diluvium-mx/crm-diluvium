> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Oferta del Buen Fin en el Agente IA: aviso temporal que se apaga solo (13-nov-2026, sin migración)

**Pedido del dueño (13-nov).** Del 13 al 17 de noviembre la compuerta estándar está en oferta por el Buen Fin en
**$5,199** (el mismo precio de la página web; en Amazon también, en Mercado Libre todavía no). El Agente IA tiene que
decirlo cuando pregunten el precio, sin tocar el Goal ni otra instrucción, porque solo son cuatro días.

**Por qué no en el Goal ni en una FAQ.**
- El Goal está en el bloque 1 de la caché: cambiarlo cuesta la reescritura completa (~US$0.11) al ponerlo y otra al
  quitarlo, y solo después de las 22:00.
- Una FAQ va en el bloque 2 (~US$0.025 por cambio desde el 11-nov), pero el modelo no recibe la fecha de hoy: alguien
  tendría que acordarse de apagarla el 17. Además el Goal dice en cuatro partes «$5,500» y «no manejamos descuentos», y
  una FAQ a media instrucción puede perder contra eso.

**Qué hace.** `buenFinOfertaLine(now)` (`lib/ai/runtime/buen-fin-oferta.ts`) agrega una línea al
`[CONTEXTO DEL CRM]` del último mensaje del cliente (`run.ts`, junto a la etapa, la cotización y el Detalle) **solo del
13-nov 00:00 al 17-nov 23:59:59 hora de Mazatlán** (las fechas del temporizador de la columna). Esa parte no está en la
caché: **no cuesta reescritura** y el 18-nov a las 00:00 deja de salir sin que nadie haga nada. Va a los dos modelos
(Luna y Sonnet) y a todos los chats, no solo a los de la columna Buen Fin.

**Reglas del aviso (dueño, 13-nov).**
- Dice siempre solo la cifra de oferta ($5,199); nunca menciona, compara ni recuerda el precio normal.
- Las fechas van una sola vez: la primera vez que da el precio lo dice como oferta por el Buen Fin, del 13 al 17 de
  noviembre; si en el chat ya se dijo (p. ej. los workflows «Información» y «Precio 2»), no lo repite, y después no
  vuelve a mencionar las fechas.
- Si pide descuento o se le hace caro, ese ya es el precio de oferta: no ofrece otro descuento.
- Totales y `fijar_cotizacion` con $5,199 por compuerta estándar (si un vendedor ya fijó la cotización, esa manda); para
  pagar con tarjeta una compuerta estándar, el link de pago de $5,199.
- La oferta es solo de la compuerta estándar, pero el Agente IA no lo dice: la hecha a la medida y la mini siguen con su
  precio y con ellas no menciona la oferta.

**Fuera del código (en producción, con OK del dueño).**
- Workflows «Información» y «Precio 2»: el texto «Ahorita tenemos cualquier tamaño en $5,500 con envío gratis» cambia a
  «Ahorita tenemos todos los tamaños en oferta por el Buen Fin, del 13 al 17 de noviembre, por tan solo $5,199 con envío
  gratis.» (los workflows no están en la caché: no cuesta). **El 18-nov se regresa** al texto de antes.
- Links de pago: «1 compuerta estándar (Buen Fin)» de $5,199 (link del dueño). Cambiar los links es el bloque 2 de la
  caché (~US$0.025 al cargarlo y otro tanto al quitarlo). **El 18-nov se quita.** Con 2 o más compuertas no hay link de
  oferta: el candado del total manda el aviso al vendedor para que lo mande él.

**Al terminar.** El código se quita junto con la columna Buen Fin (`ETAPAS_FUERA_DEL_AGENTE`); mientras tanto no hace
nada fuera de las fechas. Pruebas: `buen-fin-oferta.test.ts` (fechas de inicio y fin, sin «$5,500», reglas del dueño).
