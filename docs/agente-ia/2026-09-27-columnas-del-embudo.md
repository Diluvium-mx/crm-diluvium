> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Columnas del Embudo (27-sep-2026)

Rama `feat/columnas-embudo`, migración **`0041_columnas_embudo`**.

- **Datos.** Tabla `funnel_stages` por organización: clave estable, nombre, orden, papel, regla del Agente IA y modelo (1 o
  2). La columna `color` existe pero no se usa: el dueño quitó el color el 27-sep (todas las columnas en azul). `contacts.stage` y `workflows.trigger_stage` pasan de enum a texto con llave foránea compuesta. La
  0041 siembra las 5 de siempre con las mismas claves y nombres; la regla de cada una es la del bloque "ETAPAS DEL
  EMBUDO" del Goal de producción y el modelo se copia de `ai_config.etapas_modelo_1` **vigente al migrar**. Toda
  organización nueva nace con las 5 (trigger `funnel_stages_seed_org`). `ai_config.etapas_modelo_1` queda sin uso
  (se conserva para que el web y el worker anteriores funcionen durante el despliegue; borrarla en una migración
  posterior). Volumen de prueba: 10,973 contactos con el reparto de producción, `db:deploy` en 0.6 s y conteos iguales.
- **Papeles** (uno por etapa, cada uno en exactamente una): Entrada (contactos nuevos; siempre la primera columna),
  Cerca de compra (datos bancarios y /banco) y Venta cerrada (un vendedor confirmó el pago en el chat, desde el 2-oct;
  Anuncios › Compraron). Cerca de compra va antes que Venta cerrada. Una etapa con papel se renombra, pero no se borra hasta pasar su papel.
  Entre 3 y 10 etapas.
- **Agente.** Al final del system (después del sufijo del CRM y de la longitud) va el bloque "ETAPAS DEL EMBUDO
  (las define el CRM)" con clave, nombre y regla en el orden actual. `mover_etapa` acepta solo las claves
  vigentes; "solo hacia adelante" sigue el orden actual. El contexto del CRM muestra el nombre vigente. El modelo
  de cada etapa, el traspaso Luna → Sonnet y el respaldo entre modelos leen `funnel_stages.model_slot`
  (`lib/ai/runtime/model-by-stage.ts`); datos bancarios implica la etapa con papel Cerca de compra.
- **Editor.** Subpestaña **Etapas** de Agente IA (en Modelos queda un enlace) y el lápiz del Embudo (mismo
  componente, `app/(app)/_components/stages-editor.tsx`). Todo cambio pide confirmación (TopConfirm). Borrar pide a
  qué columna pasan los contactos y los mueve en una transacción (candado de la fila: un movimiento concurrente
  espera y falla limpio), deja sin etapa los workflows que se disparaban al entrar y manda UN `stages.updated`.
  Lo editan vendedores, admin y owner (ACL `funnelStage`).
- **Resto del CRM.** Ingesta y contactos nuevos: etapa con papel Entrada. /banco: papel Cerca de compra. Anuncios:
  papel Venta cerrada. Importador GHL: nombre vigente de la columna (y, de respaldo, el nombre de siempre si su
  clave sigue). Dashboard, Detalle, chip del chat, avisos emergentes y Automatización leen los nombres del
  contexto en vivo (`funnel-stages-provider.tsx`, relee también en cada reconexión del SSE).
- **Goal.** El bloque "ETAPAS DEL EMBUDO" del Goal se vuelve redundante. La versión nueva del Goal sin ese bloque
  se aplica solo con el "OK GOAL ETAPAS" del dueño (propuesta en `~/Documents/Diluvium CRM/notas/goal-etapas-propuesta/`).
  Mientras no se aplique, las dos listas dicen lo mismo; si se edita una regla antes, el Goal viejo la contradice.
- **Revisión (27-sep):** Claude adversarial + Codex + cyber-neo (0 reales). Corregido con prueba: orden de los papeles
  (Entrada primero, Cerca de compra antes que Venta cerrada), relectura de etapas al reconectar, candado al borrar,
  importador con el nombre de siempre.
- **Teóricos (sin escenario real hoy):**
  - Si alguien pone una etapa sin papel DESPUÉS de Venta cerrada y un contacto está ahí, un pago ya no lo mueve a
    Venta cerrada (sería retroceso); el aviso "Depósito recibido" del agente sí le llega al vendedor.
  - Si pasan el papel Venta cerrada a otra columna durante los segundos de una respuesta, el agente mueve a la
    clave que pidió (la vieja).
  - Borrar una etapa deja a sus contactos como movidos por "sistema" (pierden la marca de "lo puso un vendedor") y
    arriba de la columna destino.
  - El editor viejo (1–2 min del despliegue) guarda el modelo por etapa en `etapas_modelo_1`, que ya no se lee.
  - Las etapas nuevas nacen con el Modelo 2 (más caro) hasta que alguien lo cambie.
  - La descripción del workflow "Datos bancarios" (`lib/workflows/defaults.ts`) dice "Cerca de compra" aunque se renombre.
