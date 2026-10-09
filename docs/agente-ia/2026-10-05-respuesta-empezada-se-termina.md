> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Respuesta que ya empezó se termina (5-oct-2026, sin migración)

Caso del 2-oct, 7:44 p.m. El Agente IA escribió dos mensajes: «…en nuestra página web o en Amazon:» y el
link. El cliente escribió «Es fácil de instalar» (su mensaje llegó 0.1 s después del 1.er mensaje) y el envío
se detuvo: el link no salió y nadie avisó. Además, la pregunta del cliente se quedó sin contestar 10 minutos:
su hora de WhatsApp era anterior al 1.er mensaje (mensaje tapado, sección anterior). Pasó 13 veces del
26-sep al 3-oct.

- Si el cliente escribe cuando ya salió el 1.er mensaje, **el resto de la respuesta sale igual**. Esos
  mensajes llevan `respondeHasta` = la hora del último mensaje que leyó el modelo (`markAnswersUntil`):
  no cuentan como respuesta a lo nuevo, que sigue pendiente y lo contesta la siguiente corrida.
  `ai_usage.error`: «terminó la respuesta (N mensaje(s)) aunque el cliente escribió en medio».
- Si lo que detiene el envío es **un vendedor** o **una pausa / el Agente IA apagado**, el resto no sale
  y queda una tarjeta con el texto que faltó («El Agente IA se detuvo tras 1 de 2 mensajes (un vendedor
  contestó)…»). Antes se perdía sin aviso.
- El barrido (y la alarma del monitor, que usa la misma consulta) ordena los entrantes con la hora del
  Agente IA (`agentAtSql`), igual que los pendientes: un mensaje tapado ya no pasa por contestado.

Pruebas: `lib/ai/runtime/run.int.test.ts` (entre burbujas y «caso 2-oct»).
