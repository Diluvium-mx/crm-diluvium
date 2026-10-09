> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Mensaje tapado y red contra el silencio (5-oct-2026, sin migración)

Revisión de 670 chats (30-sep → 5-oct): casi todas las preguntas que se quedaban sin contestar venían de dos
fallas de código, no del modelo.

- **Mensaje tapado.** WhatsApp da la hora en que el cliente ESCRIBIÓ y el mensaje llega de 2 a 40 s después. Si en
  ese hueco salía una respuesta del CRM, con la hora de WhatsApp el mensaje quedaba ANTES de la respuesta: contaba
  como contestado y el modelo lo leía como si ya se hubiera atendido (34 mensajes en el periodo, 6 chats sin
  respuesta). Ahora, para el Agente IA y el lector, un entrante vivo va después de todo saliente que ya existía
  cuando llegó (`agentAtSql` en `lib/ai/runtime/context.ts`): pendientes, orden del historial, candado
  anti-repetición, red contra el silencio, `respondeHasta` y `inboundAfter`. La Bandeja, la ventana de 24 h y el
  historial copiado del celular siguen con la hora de WhatsApp. Una ráfaga del cliente sin respuesta en medio
  conserva el orden de WhatsApp.
- **Red contra el silencio.** `sentToClientSinceLastInbound` contaba como "ya contestado" un workflow por palabra
  clave de un mensaje ANTERIOR aunque el cliente hubiera escrito después («Quiero más información» → Información, y
  luego «¿Hacen envíos?»). Ahora solo cuenta el workflow del ÚLTIMO mensaje del cliente; si escribió después, escribe
  el otro modelo o queda el aviso `sin_respuesta`.

Pruebas: `lib/ai/runtime/mensaje-tapado.int.test.ts`.
