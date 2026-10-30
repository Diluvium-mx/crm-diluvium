> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## «Buenas noches» después de despedirse es despedida, no saludo (30-oct-2026, sin migración)

**Origen:** chat del 29-oct en Prospecto. La clienta dijo que mandaría las medidas en diciembre y agradeció; el Agente
IA le contestó «Quedamos pendientes… Gracias a usted por su atención» y ella escribió «Buenas noches». Luna contestó
«Buenas noches, ¿en qué puedo ayudarle?».

**Diagnóstico (lectura de prod):**
- Contestó GPT-5.6 Luna, que es lo correcto: Inbox y Prospecto van con el Modelo 1 (decisión del 8-oct) y sin foto de
  su entrada no era Interesado. No fue falla del modelo: en 30 días Luna contestó bien otros 3 «Buenas noches» de
  despedida («Con gusto, que tenga muy buenas noches»).
- La causa es el Goal (MENSAJES CON METADATA DE ANUNCIO): «Si el texto real del cliente es solo un saludo… responde con
  un saludo cordial y pregunta en qué puedes ayudarle», sin decir que es para el inicio. El Goal es el mismo para los
  dos modelos: con Sonnet habría pesado igual.
- El código no lo cubre a propósito: `isBareAck` no cuenta un saludo solo como acuse (14-oct), porque «Buenas noches»
  también es como mucha gente empieza a escribir.

**Cambio (OK del dueño, 30-oct; solo el Goal):** la regla del saludo aplica cuando la plática va empezando o se retoma
después de un rato, y debajo va: «Si el cliente ya se estaba despidiendo o agradeciendo y después solo escribe «Buenas
noches», «Bonita noche», «Que descanse» o algo parecido, es una despedida, no un saludo: contesta solo con una
despedida corta («Buenas noches, que descanse»), sin preguntar nada.» Programado con «Programar para las 22:00» el
30-oct (`ai_scheduled_changes`; respaldo y diff en `notas/goal-despedida/`, fuera del repo). `angela-goal.md` ya
lleva el texto nuevo.

**Vigilar en prod:** respuestas del Agente IA a un «Buenas noches» suelto que llega minutos después de una despedida.
