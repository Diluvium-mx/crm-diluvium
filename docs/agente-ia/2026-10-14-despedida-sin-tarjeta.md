# Respuesta en blanco ante un agradecimiento = nada que agregar, sin tarjeta (14-oct-2026, sin migración)

**Origen:** revisión de Sonnet 5.5 (13-oct, propuesta 2) y auditoría del 14-oct. De 10 tarjetas «El agente no pudo
responder» del 1 al 14-oct, 5 fueron a un simple agradecimiento del cliente: «Dale muchas gracias», «Muy bien gracias»,
«Okey, gracias», «Ok grasias», «oki gracias». El modelo, con razón, no tenía nada que decir y devolvió la respuesta en
blanco; el runtime lo contaba como falla, dejaba la tarjeta y el chat quedaba bloqueado hasta que un vendedor la
atendiera (a 2 de esos clientes luego les salió un seguimiento, contestaron y nadie les respondió).

**Antes:** la regla del acuse (6-oct, C2) solo perdonaba el silencio si el modelo escribía la señal «nada que agregar»
y la lista de acuses era de frases exactas («ok gracias» sí, «okey gracias» o «muy bien gracias» no).

**Cambio (OK del dueño, 14-oct):**
- `isBareAck` (`lib/ai/runtime/unanswered.ts`) reconoce el acuse por palabras: al menos una de acuse (ok, okey, oki,
  va, vale, dale, sale, gracias, grasias, perfecto, excelente, entendido, listo, bien, de acuerdo…) y todas las demás de
  cortesía (muy, muchas, mil, por la información, buenas noches, saludos…). «Sí», «Claro», un saludo solo, una duda o
  un dato («Gracias, el lunes mido») siguen sin ser acuse.
- `run.ts`: si todo lo pendiente del cliente es acuse, la respuesta en blanco vale lo mismo que «nada que agregar»: no
  sale nada, sin tarjeta, sin segundo intento y sin aviso «sin respuesta». Ante una pregunta, el blanco sigue siendo falla.

**Vigilar en producción:** tarjetas `agente_error` con «no pudo responder» y filas de `ai_usage` con
«sin texto: el cliente solo confirmó o agradeció».
