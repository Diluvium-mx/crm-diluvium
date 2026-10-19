> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Promesas y esperas también son acuse, sin tarjeta (19-oct-2026, sin migración; arreglo D)

**Origen:** revisión del 16 al 19-oct. Después del arreglo del 14-oct ([despedida sin tarjeta](2026-10-14-despedida-sin-tarjeta.md))
quedaron 3 tarjetas «El agente no pudo responder» ante clientes que solo confirmaban: «Sí muchas gracias» (15-oct), «si lo
hare» (18-oct; la clienta iba a mandar el número de una vecina y el chat quedó en pausa) y «Agradezco mucho su atención y
espero la respuesta de su compañero 🙏🏻» (19-oct). Antes del 14-oct, también «Sí, gracias.», «Correcto quedo en espera de
que me contacten» y «quedo atento a sus comentarios».

**Cambio** (`unanswered.ts` › `isBareAck`; `run.ts` le pasa `afterQuestion`):
- Nuevas palabras de acuse: promesas y esperas («haré», «espera», «espero», «pendiente», «atento/a»), con su cortesía («quedo»,
  «su respuesta», «sus comentarios», «me contacten», «su compañero», «asesor», «mucho su atención»…).
- **«Sí», «Claro» y «Correcto»** cuentan solo junto a una palabra de acuse **y solo si el último mensaje de la empresa no
  terminaba en pregunta**. Ante «¿Le explico cómo medirla?», «Sí, gracias» es un «sí, por favor»: hay que contestar.
  Esto cambia la decisión del 14-oct («Sí, gracias» nunca era acuse) por la del dueño del 19-oct.
- Solos («Sí», «Claro», «Correcto») o con un dato («Sí, lo haré mañana», «Espero el precio») nunca son acuse.

**Qué hace un acuse (sin cambio):** la respuesta en blanco o «nada que agregar» vale como no contestar, sin tarjeta ni
pausa, y el modelo puede volver a la pregunta pendiente. Si el modelo sí quiere contestar, contesta igual.

**Vigilar en prod:** tarjetas «no pudo responder» ante una confirmación (deben bajar) y chats donde un «Sí, gracias» se
quedó sin la respuesta que pedía.
