> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Instagram se queda en Inbox hasta la foto y la medida (27-oct-2026, sin migración)

**Qué pasó:** el dueño veía que muchos contactos de Instagram, varios de otros países, pasaban a Prospecto. Lectura
de producción del 27-oct: de 798 contactos de Instagram, 144 estaban en Prospecto y **ninguno había mandado una
foto**. Además, ningún contacto de Instagram tenía comprobante ni pago. La causa no era una falla: el Agente IA y el
lector seguían la regla de la columna Prospecto. Del 3 al 16-oct la regla decía «cuando el cliente escribe por primera
vez, aunque solo salude», y así pasaron 74. El 16-oct se endureció a «cuando da un dato de su caso (medidas, cuántas
compuertas, hasta dónde sube el agua)» y aun así pasaron 26 más, todos sin foto: «Quiero 1», «Un metro», «para
puertas de 80 cm», muchos de Argentina, Ecuador, España o Costa Rica. En Instagram ese dato no dice nada.

**Decisión del dueño:** en Instagram el contacto se queda en **Inbox** hasta que el cliente mande una **foto de su
entrada** y dé **la medida**; con las dos pasa directo a Interesado (en Instagram no se usa Prospecto). Los que ya
estaban en Prospecto los mueve él a mano (no se tocaron en producción).

**Cómo** (`lib/ai/runtime/instagram-entrada.ts`, puro):
- **El código frena lo que puede ver:** en un chat de Instagram sin ninguna imagen del cliente, el Agente IA no puede
  llevar al contacto a ninguna etapa antes de la de papel «Cerca de compra» (`instagramAllowedStage`). Vale para el
  que contesta (`actions.ts`), para el traspaso al Modelo 2 (`run.ts`: sin etapa nueva no hay traspaso, así que un chat
  de Instagram sin foto no pasa a Sonnet) y para el lector en segundo plano (`lector.ts`; lo frenado queda en
  `ai_usage.error` como «descartado: etapa …: chat de Instagram sin foto del cliente»).
- **El modelo juzga el resto:** que la foto sea de su entrada y que haya dado la medida. En los chats de Instagram
  recibe la línea «Chat de Instagram: el contacto se queda en «Inbox» hasta que el cliente mande una foto de SU entrada
  y dé la medida…» (`instagramStageLine`). Va en el contexto del CRM del último turno del cliente y en la ficha del
  lector, **no en el system**, para no romper la caché del prompt.
- **Lo que no cambia:** los datos bancarios y el comprobante mueven a «Cerca de compra» y «Compra» como siempre, aunque
  no haya foto (una venta no se pierde). WhatsApp sigue igual. Un vendedor puede mover a mano cualquier contacto.
- Sigue al **papel** de las columnas (entrada y «Cerca de compra»), no a sus claves: si se renombran o se agrega una
  columna en medio, la regla sigue valiendo.
- No toca el Goal ni las FAQs (no aplica la regla de las 22:00) ni la regla escrita de cada columna.

**Pruebas:** `instagram-entrada.test.ts` (unitarias), `run.int.test.ts` y `lector.int.test.ts` («Instagram
(27-oct-2026)…»): sin foto se queda en Inbox aunque el modelo pida Prospecto, con foto avanza, los datos bancarios sí
mueven y WhatsApp no lleva la línea.
