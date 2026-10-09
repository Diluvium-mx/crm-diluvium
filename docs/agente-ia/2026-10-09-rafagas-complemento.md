> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Ráfagas: el complemento revisa cada mensaje y deja la ráfaga contestada (9-oct-2026, sin migración)

Revisión de producción (1 al 9-oct, pedida por el dueño al probar «Entrada mayor a 2.5 m» con «Ya la medí» + «y mide
4.2 m»): de 846 corridas por palabra clave con «El workflow es la respuesta», 23 fueron ráfagas (el cliente toca una
pregunta del anuncio —«¿Cuánto tarda el envío?», «¿Cómo funciona?», «¿Es fácil de instalar…?»— o saluda, y luego escribe
«Precio»). El workflow contestaba el ÚLTIMO mensaje (`contestaA`) y lo anterior seguía pendiente; si el complemento decía
que no faltaba nada, el barrido lo tomaba ~90 s después y el Agente IA lo contestaba aparte: en 7 de 23, cinco preguntas
reales contestadas tarde (del 5 al 7-oct, cuando Luna devolvía respuestas vacías; arreglado el 8-oct, ce14291) y dos
saludos con un «Buenas tardes 😊» de más (que además intentaba repetir la pregunta del workflow; lo frenaba el candado).

- **Nota del complemento** (`complementNote`, complement.ts): ahora **nombra cada mensaje** que el agente revisa
  («estos 2 mensajes seguidos: «¿Cuánto tarda el envío?» · «Precio». Revisa CADA uno, no solo el último»; `saidText`: una
  línea, 160 caracteres, nota de voz con su transcripción; los 8 más recientes), aclara que mencionar el tema no basta
  («envío gratis» no dice cuánto tarda) y que si el cliente dio la medida de OTRA entrada se le dice su tamaño y precio.
- **Lo revisado queda contestado** (`answeredOnlySql`, context.ts): con la marca de revisión (`revisaAgente`), una vez que
  el agente revisó el disparador quedan contestados también los entrantes ANTERIORES a él (el agente leyó la ráfaga
  completa en modo complemento). Mientras no se revise, lo anterior sigue pendiente y el barrido lo rescata. Las marcas
  sin revisión (anteriores al 30-sep) siguen cerrando solo su disparador (bug de la ráfaga del 29-sep).
- **Banco** (`~/Documents/Diluvium CRM/notas/banco-rafaga`, Goal/FAQs/workflows de producción del 9-oct, sin enviar): las
  23 ráfagas reales + 5 del workflow del poste, Luna y Sonnet. Ráfagas reales: nota anterior 45/46, nota nueva 138/138.
  Poste: Sonnet 10/10 con las dos; Luna fallaba «la puerta de 1.10 y la cochera de 5 metros» con las dos (0/4) → con la
  línea de «OTRA entrada», 5/6 y los demás casos 6/6. Costo del banco: US$1.29.
- **Riesgo aceptado:** si el complemento no ve una pregunta de la ráfaga, ya no hay rescate del barrido; el banco no
  tuvo ninguna falla así con la nota nueva.
- Pruebas: `complement.test.ts` (nota con la ráfaga, 8 más recientes, `saidText`) y `run.int.test.ts` («Buenas tardes» +
  «Precio» sin pendientes tras revisar; marca vieja sin revisión: lo anterior sigue pendiente; «Ya la medí» + «y mide
  4.2 m» con el workflow del poste). Las dos de ráfaga fallan sin el cambio de `answeredOnlySql`.
