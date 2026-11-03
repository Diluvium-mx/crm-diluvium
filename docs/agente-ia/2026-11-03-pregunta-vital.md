> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Pregunta vital: después de un workflow que no pregunta, el Agente IA cierra con una (3-nov-2026, sin migración)

- **Pedido del dueño (2-nov, «OK texto y D» el 3-nov):** «que tabla de tamaños termine con una pregunta, de esta forma
  abarcamos que todos los workflows terminen haciendo una pregunta de acuerdo al contexto y avance del chat». Su ejemplo:
  el cliente escribió «Tienen medidas o son una sola medida», salió la Tabla con su pie («Aquí le comparto una foto de los
  tamaños disponibles para envío inmediato») y un vendedor tuvo que escribir a mano «¿Usted tiene problemas de inundaciones?».
- **Antes:** tras un workflow «El workflow es la respuesta» el Agente IA revisaba el mismo mensaje en modo complemento y
  el CRM le quitaba TODA pregunta (`withoutClosingQuestions`, 30-sep y 9-oct). Bien cuando el workflow ya pregunta
  («Información», «Precio 2», «Entrada mayor a 2.5 m»); mal con los dos que terminan sin pregunta en prod (la Tabla
  estándar y «Dónde medir»): el chat quedaba sin siguiente paso.
- **Ahora** (`run.ts`, `complement.ts`, `unanswered.ts`):
  - Si lo que salió después del último mensaje del cliente ya trae «?» (`asksSomething`), todo sigue igual: sin preguntas.
  - Si no, la nota del complemento (`complementNote(…, { mayAsk: true })`) pide cerrar con UNA pregunta del dato vital que
    falte (inundaciones, nivel del agua, medida o foto, según FLUJO CONVERSACIONAL), nunca la misma frase de una pregunta
    ya hecha (PREGUNTA SIN CONTESTAR), y ninguna en cierre, objeción o despedida. Si no hay nada más que contestar,
    escribe solo esa pregunta; si tampoco falta un dato, `[NADA_QUE_AGREGAR]` como antes.
  - `withOneClosingQuestion`: sale a lo mucho una, la del final del último mensaje; las demás se quitan.
  - `withoutUnansweredRepeatInComplement`: si la pregunta repite la que el cliente dejó sin contestar, se quita aunque no
    quede nada (en el complemento callar es válido): sin otro intento del modelo ni tarjeta.
- **Va con el Goal del 3-nov-2026 22:00** (programado con OK del dueño; espejo en `angela-goal.md`): PREGUNTA SIN CONTESTAR
  (contestar breve sin pregunta si la nuestra quedó arriba; retomar el dato vital con otras palabras si el cliente sigue
  sin darlo; tras una automatización sin pregunta, cerrar con el dato que falte), «ok»/«gracias» solo no es despedida
  (una invitación a dar la medida, con el porqué de su caso) y mini compuerta si el agua llega a 20 cm o menos (salvo
  entrada de más de 123 cm). Medición que lo respalda (prod 22-sep → 2-nov, solo cifras): de 195 clientes que contestaron
  «¿Usted tiene problemas de inundaciones?» con otra pregunta, solo a 27 se les pidió después la medida; 278 chats se
  callaron tras un «ok/gracias» contestado sin pregunta; cuando Ángela pide la medida, el 76 % la contesta en 24 h.
- **Costo:** ninguno; la revisión del complemento ya se hacía. Sin cambios en los workflows.
