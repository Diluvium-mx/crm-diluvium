> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Chat sin Agente IA: el chat propio del dueño queda fuera (26-oct-2026, migración 0071)

**Qué pasó:** el dueño usa un chat consigo mismo (otro número suyo que le escribe al número del CRM) para pasarse
mensajes. Aunque el Agente IA estaba «Pausado indefinidamente», el lector lo seguía leyendo (el lector trabaja
siempre, aun con el Agente IA pausado o apagado: [segundo plano](2026-09-28-segundo-plano-etapa-y-detalle.md)) y le
llenó el Detalle como a un cliente: Prospecto, monto de $5,500, 2 entradas y 70 % de convencimiento. Además, si a ese
chat le salía un seguimiento y él contestaba, el Agente IA se reactivaba solo (`resumeAgentOnFollowUpReply`).

**Decisión del dueño:** que el Agente IA no lea nada de ese chat y lo excluya. **Fijo («hardcodeado»), sin interfaz
para marcarlo y sin etiquetas** de «prueba» (se descartó un interruptor en el Detalle y reusar la marca «Prueba»:
`contacts.es_prueba` la llevan los contactos que nacen en el número de prueba, y el Agente IA sí debe contestarles
para poder probarlo en staging).

**Cómo:** columna `contacts.sin_agente_ia` (migración **0071**, falso por defecto). La misma migración marca el
contacto del dueño por su **id** (el teléfono no va al repo, que es público). Para marcar otro chat después: un
`update contacts set sin_agente_ia = true where id = …` en producción, con el OK del dueño.

Con la marca, en todos los chats de ese contacto:
- **Respuesta del Agente IA:** no se programa al llegar un mensaje ni al vencer la pausa (`hooks.ts`, `schedule.ts`),
  el barrido de chats sin respuesta no lo toma y no cuenta para la alarma «Agente IA callado» (`sweep.ts` ›
  `unansweredSql`), y si una corrida llega de todos modos (job viejo, «Reintentar») se salta antes de leer nada
  (`run.ts`, motivo `sin_agente_ia`). Un seguimiento contestado ya no lo reactiva.
- **Lector:** el barrido no lo toma (`lector-worker.ts`) y «Despertar» tampoco lo lee (`lector.ts`). El indicador del
  Detalle («leerá el chat…», «✓ Al día · leído…») no se muestra (`lector-status-store.ts`).
- **Seguimientos:** cuenta como Agente IA apagado (`store.ts` › `channelOn`): no se arma ninguno y el que ya estaba se
  cancela al llegar su hora sin salir (`cancel_reason = agente_apagado`). La píldora queda dormida con «El Agente IA no
  lee este chat: no hay seguimientos.», sin «Despertar» (`view.ts`).
- **Palabras clave:** no disparan ningún workflow (`triggers.ts` › `onInboundKeyword`).

**Lo que NO cambia:** el chat se ve y se usa igual en la Bandeja (mandar, recibir, plantillas, ventana de 24 h); las
notas de voz se siguen transcribiendo (no es el Agente IA); lo que el lector ya había llenado en el Detalle se queda
como está (se limpia a mano si hace falta); el Dashboard lo cuenta como hasta hoy; el interruptor «Pausado / Activar»
del Detalle sigue ahí, pero aunque se active no contesta.

**Pruebas:** `lib/ai/runtime/sin-agente-ia.int.test.ts` (dos chats iguales, uno marcado: lector, indicador, programar,
barrido y corrida), `lib/followups/envio.int.test.ts` (cancelado sin salir y píldora) y
`lib/workflows/triggers.int.test.ts` (palabra clave con y sin la marca).
