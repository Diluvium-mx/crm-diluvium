## Caché en dos partes y herramientas fijas (11-nov-2026, sin migración)

**Por qué.** Con Sonnet 5.5, cualquier cambio en lo que va guardado en caché (una FAQ, un link de pago, una talla,
una columna del Embudo) obligaba a Anthropic a volver a escribir **todo**: herramientas + Goal + FAQs, ~27 mil tokens,
**~US$0.11** cada vez (escritura de 1 h = 2× la entrada). El Goal solo es ~25 mil de esos tokens y casi nunca cambia;
lo que se edita seguido (FAQs, links, columnas) es lo chico.

**Qué cambia.**
1. **El system va a Anthropic en dos bloques**, cada uno con su marca de caché de 1 h
   (`buildBrainSystemParts` en lib/ai/runtime/brain.ts; `systemBlocks` en lib/ai/providers/anthropic-cache.ts):
   - Bloque 1: el Goal (las herramientas van antes y ya son fijas).
   - Bloque 2: FAQs, Tallas y medidas, instrucciones del CRM, etapas del Embudo y, nuevo, **LINKS DE PAGO** (las
     opciones de `enviar_link_pago` con su clave, lo que cobran y si es de contado o a meses).
   Si solo cambia el bloque 2, Anthropic lee el 1 de caché y escribe ~3 mil tokens: **~US$0.01** en vez de 0.11.
   Con la marca del historial son 3 de las 4 que permite Anthropic.
2. **Herramientas fijas.** `mover_etapa` y `enviar_link_pago` ya no llevan la lista de etapas ni de links (antes
   iban en un enum y en la descripción, al principio de la caché). Ahora reciben un texto y el CRM valida que sea una
   clave vigente (`validateToolCalls`); una clave que no existe se ignora como antes («argumentos inválidos» /
   «opción inválida»). `enviar_link_pago` sigue existiendo solo si la organización tiene links del Agente IA.
3. **El texto completo es el mismo** para los demás proveedores (OpenAI/Luna recibe el system de una pieza, como
   siempre; solo se agrega la sección LINKS DE PAGO al final). `callModel` recibe `systemCacheBreak` (dónde empieza
   el bloque 2) y solo el adaptador de Anthropic lo usa. La renovación de la caché (cache-keepalive.ts) manda el mismo
   corte que las respuestas.

**Lo que NO cambia.** Un cambio del **Goal** sigue costando la reescritura completa (~US$0.11): por eso se sigue
aplicando una vez al día, después de las 22:00. Tampoco cambian los candados del link de pago, el lector de Luna ni
el modelo de cada etapa.

**El día que entra a producción.** El formato nuevo se escribe una vez completo (~US$0.11). Para no pagarlo dos veces,
se sube **antes** de un cambio programado de FAQs o links (decisión del dueño, 11-nov: las 3 FAQs de las fundas y sus
links entran después de esto): ese cambio ya solo cuesta el bloque 2.

**Cómo verlo en producción.** En `ai_usage`, una respuesta de Sonnet tras cambiar una FAQ debe mostrar
`cache_read_tokens` ≈ 25 mil (el Goal) y `cache_write_tokens` ≈ 3 mil, no ~27 mil escritos.
