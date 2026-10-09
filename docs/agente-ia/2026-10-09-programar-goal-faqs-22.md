> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Programar el Goal y las FAQs para las 22:00 (9-oct-2026, migración 0066)

Pedido del dueño para cumplir la regla de arriba sin que alguien tenga que estar despierto a las 22:00.

- **Tabla `ai_scheduled_changes`** (una fila por organización): `goal` y/o `faqs` programados (null = esa parte no
  cambia), `base_goal`/`base_faqs` = cómo estaba en vivo al programar, `apply_at` (las 22:00 de Mazatlán; de 22:00 a
  6:00, de inmediato), `status` (`programado` | `conflicto`) y `conflict`.
- **Editor** (`app/(app)/agente-ia/_components/schedule-controls.tsx`, `goal-editor.tsx`, `faq-editor.tsx`): selector
  «Cuándo se aplica: Hoy a las 22:00 · Ahora (error grave)», por defecto 22:00. En 22:00 el Goal se programa
  (`scheduleAgentGoal`) y cada cambio de FAQs (agregar, editar, borrar, activar, borrar varias) cambia la lista
  PROGRAMADA (`scheduleAgentFaqs`, la lista completa; reglas puras en `lib/agente-ia/scheduled-rules.ts`); restaurar
  una versión la programa (`scheduleAgentVersion`). «Ahora» usa los guardados de siempre y después quita de lo
  programado lo que ya quedó igual en vivo (`pruneScheduled`). Aviso arriba con «Aplicar ahora» y «Quitar programación».
- **Worker** (`worker/index.ts`, barrido de cada minuto → `applyDueScheduled`, `lib/agente-ia/scheduled-store.ts`): a
  su hora aplica Goal y FAQs en UNA transacción (`writeGoal` + `writeFaqs` de `editor-store.ts`, una versión de cada uno
  llamada «Programado para las 22:00»; las FAQs conservan id y ancla de GHL) y borra la fila. Así se paga una sola
  reescritura del Goal al día.
- **Choque:** si después de programar alguien guardó «Ahora» y lo de en vivo ya no es lo de `base_*`, no se pisa: la
  fila queda en `conflicto` con el motivo y el aviso ofrece «Aplicar de todos modos» (`force`) o «Quitar programación».
  Una parte que ya quedó igual en vivo no choca.
- **Workflows y despliegues (medido, 3 al 9-oct):** de las 29 reescrituras del Goal, las ediciones de workflows
  explican ~0.5 (≈ US$0.20 al mes) y los despliegues que cambian el sufijo o las herramientas ~2 (≈ US$0.84 al mes, en
  una semana con 4 de esos despliegues). No necesitan la regla de las 22:00; los despliegues que cambian las
  instrucciones del Agente IA conviene juntarlos cuando se pueda.
