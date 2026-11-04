> Parte de [Agente IA](../agente-ia.md) (índice con todas las decisiones).

## La columna «Buen Fin» queda fuera del Agente IA (4-nov-2026, sin migración)

**Qué pasó.** El 3-nov a las 16:20 se creó en producción la columna temporal «Buen Fin» del Embudo (clave `buen_fin`, al
final, Modelo 1, sin regla). La lista de etapas va al final de las instrucciones del Agente IA (`stagesInstructions`) y
en la acción `mover_etapa`, y Anthropic guarda en caché todo ese texto como un solo bloque (punto de caché en el system,
`lib/ai/providers/anthropic.ts`). Al cambiar la lista se volvió a escribir completo para Sonnet: US$0.12 a las 16:42. Lo
mismo habría pasado al editarla o borrarla al terminar la campaña.

**Decisión del dueño.** Sonnet no tiene nada que ver con esa columna mientras no esté en funcionamiento:

- `ETAPAS_FUERA_DEL_AGENTE` + `stagesForAgent()` (`lib/contacts/stages.ts`) la sacan de las instrucciones del cerebro, de
  la lista y la descripción de `mover_etapa` (`tools.ts`) y del lector (`lector-core.ts`: instrucciones y claves de
  `etapa`). Con la columna o sin ella, todo queda idéntico al texto de antes del 3-nov
  (`etapas-fuera-del-agente.test.ts`), así que editarla, llenarla o borrarla ya no cobra nada.
- Sus contactos los atiende el Modelo 1 (`model_slot` 1). En una etapa del Modelo 1 el Modelo 2 nunca contesta por él
  (8-oct, `brainCandidates`), y no hay traspaso porque es la última columna y solo se avanza.
- El resto del CRM sí la ve: tablero, orden, arrastre y `isForward` usan todas las etapas.

**Costo de subirlo.** Quitarla de las instrucciones también cambia el texto una vez: al desplegar en producción, Sonnet
vuelve a escribir su caché UNA vez (≈ US$0.12). Por la regla del Goal (cambios que vuelven a cobrar, una sola vez al día
después de las 22:00), el despliegue a producción va después de las 22:00. Después ya nada de esa columna cobra.

**Al terminar la campaña:** borrar la columna (lápiz) y quitar `buen_fin` de `ETAPAS_FUERA_DEL_AGENTE`, del encabezado rojo,
del temporizador y del contorno (mapa › Embudo › 36).
