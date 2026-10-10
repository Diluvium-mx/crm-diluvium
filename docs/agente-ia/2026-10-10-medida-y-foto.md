> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Medida y foto según el escenario, sin «¿Desea avanzar…?» (10-oct-2026, sin migración; Goal programado para las 22:00)

Caso del 10-oct (Puerto Vallarta): el seguimiento preguntó el ancho, el cliente dijo «130», el Agente IA dio el tamaño
y el precio de la hecha a la medida y después mandó, como mensaje aparte, «¿Desea avanzar con la compuerta de 130 cm?».
El procedimiento del dueño es que, con la medida ya dada, lo siguiente es pedir una foto de la entrada para confirmar
que la instalación es viable. Una pregunta de «avanzar» se siente forzada.

**De dónde salía (Goal, no código):**
- CIERRE DE VENTA: «Con medida confirmada y tamaño asignado (y la entrada validada, si mandó foto), confirma el
  producto…». Bastaba con tener la medida y el tamaño para que el modelo creyera que ya estaba en el cierre.
- FLUJO CONVERSACIONAL pone la foto al final de la lista, pero no decía que sea el paso que sigue al tamaño y el precio.
- «No agregues preguntas genéricas… si desea continuar» existía, pero solo cuando el cliente hace preguntas antes de pagar.
- Salió en su propia burbuja porque el Goal pide la pregunta final en su bloque y `policy.ts` manda cada párrafo aparte.

**Cambio (OK del dueño, programado en producción para el 10-oct a las 22:00):**
- PRIORIDAD DE RESPUESTA, punto 9: nunca cerrar con «¿Desea avanzar con la compuerta de X cm?», «¿Desea continuar?»,
  «¿Le confirmo el tamaño?» o «¿Quiere comprarla?». Si falta un dato (medida o foto), pedir ese dato; si no falta nada,
  CIERRE DE VENTA. Se quita la línea vieja que solo aplicaba antes del pago.
- Sección nueva MEDIDA Y FOTO, por escenario (el cliente las manda en cualquier orden): ancho + tamaño y precio sin foto
  → pedir la foto; foto primero → pedir la medida y no volver a pedir foto; las dos → ninguna; no puede mandar foto o
  quiere pagar → cierre sin foto.
- CIERRE DE VENTA: se entra con la foto ya validada o con una señal de compra aunque no haya foto.

Sin pruebas con modelos reales (regla del 9-oct). Se revisan chats reales de producción el 11-oct.
Material: `~/Documents/Diluvium CRM/notas/goal-foto-despues-de-medida/`.
