> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Pregunta sin contestar: no se repite la misma pregunta (3-oct-2026, sin migración)

- **Falla (prod, 30-sep → 3-oct):** el cliente no contestaba la pregunta (casi siempre «¿Usted tiene problemas de
  inundaciones?» del final de «Información» o «Precio 2») y preguntaba otra cosa («¿En dónde están ubicados?»). El
  Agente IA contestaba su duda y volvía a hacer la MISMA pregunta, palabra por palabra: 44 veces en 40 chats (7–10 %
  de los chats atendidos al día), con Luna y con Sonnet 5. Causa: el Goal dice en seis lugares «continúa con la
  siguiente pregunta pendiente» y, si el cliente no contestó, la pendiente seguía siendo la misma; el candado
  anti-repetición solo compara contra lo que salió DESPUÉS del último mensaje del cliente.
- **Candado** (`lib/ai/runtime/unanswered.ts`, `lastQuestionAsked` en `context.ts`, aplicado en `run.ts` después del
  candado anti-repetición): la «última pregunta» es el saliente más reciente con «?» (Agente IA, workflow o vendedor;
  sin fallidos ni avisos) de las últimas **24 h**. Una burbuja del Agente IA idéntica a ese mensaje no sale; de una
  burbuja que termina con la misma pregunta final se quita solo la pregunta. Si no queda nada que mandar (el cliente
  solo dijo «Ok»), sale tal cual: nunca silencio. Queda en `ai_usage.error` («no se repitió la pregunta sin contestar»).
  Una paráfrasis u otra pregunta de la lista sí sale. No cambia a los workflows.
- **Goal** (texto aprobado por el dueño el 3-oct, con Historial): regla 3 de PRIORIDAD DE RESPUESTA ampliada («ni
  información que ya diste… Si tu pregunta anterior quedó sin contestar, sigue PREGUNTA SIN CONTESTAR») y sección
  nueva **PREGUNTA SIN CONTESTAR** en FLUJO CONVERSACIONAL: la pregunta de una automatización cuenta como «tu pregunta
  anterior»; una respuesta indirecta la contesta (sí/no, se le mete el agua, habla de su puerta o da una medida); si
  preguntó otra cosa, se contesta sin pregunta y se vuelve a ella cuando el cliente ya no tiene dudas; tiene prioridad
  sobre «continúa con la siguiente pregunta pendiente» y «no dejes la respuesta solo con el precio».
