> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Compra = un vendedor confirmó el pago (2-oct-2026, sin migración)

Caso real del 2-oct: un cliente pagó el **anticipo** de $3,500 de una compuerta a la medida de $7,000; el Agente
IA contestó «Recibimos su anticipo ✅» y, horas después, el vendedor «Confirmo de recibido ✅». El Agente IA en segundo
plano lo leyó a las 8:57 y lo dejó en «Cerca de compra» porque la regla de entonces decía «Cerca de compra … cuando
confirmas un anticipo» y «Compra … por el total». **Regla nueva del dueño:** anticipo = Compra, pero el pago lo valida
un **vendedor**: revisa el comprobante, ve qué se pagó y se lo confirma al cliente en el chat.

- **Código** (`lib/ai/runtime/venta-cerrada.ts`, puro): la etapa con papel **Venta cerrada** solo se pone si en el chat
  hay un mensaje de un vendedor (`crm` o `business_app`, igual que `HUMAN_SOURCES`) **después del último** comprobante
  del cliente (imagen o documento). El último: una foto de la puerta con un vendedor después no respalda un pago que
  llega más tarde. La confirmación del Agente IA o de un workflow no cuenta. Qué dice ese mensaje («Confirmo
  de recibido ✅», varía mucho) lo juzga el modelo; el código solo revisa quién habló y en qué orden. Sin eso, el Agente
  IA lleva al contacto **a lo más a Cerca de compra** (`allowedAgentStage`, sigue al papel, no a la clave).
- **Agente IA que contesta** (`run.ts` + `executeActions`): si pide Compra sin vendedor, va a Cerca de compra y, si el
  cliente mandó el comprobante en ese mensaje, deja **«Depósito recibido»** aunque el contacto ya estuviera en Cerca de
  compra (tarjeta amarilla: el vendedor revisa y confirma). El traspaso Modelo 1 → Modelo 2 también usa la etapa
  permitida (el contexto dice «pasa a Cerca de compra», no a Compra). No deja aviso «acción no ejecutada» (no es una
  falla: es la regla).
- **Agente IA en segundo plano** (`lector.ts`): mismo freno; en `ai_usage.error` queda «descartado: etapa compra: falta
  que un vendedor confirme el pago en el chat…». Cuando el vendedor contesta, el chat se mueve y el siguiente barrido
  (3 min sin mensajes, 15 máx.) lo pasa a Compra.
- **Instrucciones:** la línea de la etapa con papel Venta cerrada lleva una regla fija del CRM además de la editable
  (`VENTA_CERRADA_RULE` en `lib/contacts/stages.ts`), para los dos; el lector la tiene también en su campo «etapa». El
  «anticipo o total» vive en la regla editable de la columna (Agente IA › Etapas), no en el código.
- **Goal:** sus bloques «ETAPAS DEL EMBUDO» y «COMPROBANTES DE PAGO» todavía dicen «Cerca de compra si es anticipo» y
  piden confirmar el pago al cliente; el código manda igual, pero el texto del Goal se cambia solo con OK del dueño.
- **Teóricos:** (1) si el cliente manda otra imagen después de la confirmación del vendedor y antes de que lea el Agente
  IA en segundo plano, Compra espera al siguiente mensaje del vendedor. (2) Si alguien crea un workflow «al entrar a
  Cerca de compra», un comprobante con el contacto aún en Interesado lo dispararía al quedar en Cerca de compra (el 2-oct
  no hay ningún workflow por etapa en producción).
