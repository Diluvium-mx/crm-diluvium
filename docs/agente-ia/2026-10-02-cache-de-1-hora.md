> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Caché de 1 hora y renovación en horario laboral (2-oct-2026, sin migración)

**Por qué (medido en producción, 30-sep 00:00 → 2-oct 16:41 Mazatlán):** Sonnet 5 gastó US$7.80 en 310
respuestas (~US$3.0/día). El 66 % fue **escribir la caché**: cada respuesta manda ~19 mil tokens (herramientas
+ Goal + FAQs + sufijo, iguales para todos los chats) y la caché de 5 min se vencía cuando pasaban más de 5 min
entre respuestas (101 de 310). Cada una de esas costaba ~US$0.048, contra ~US$0.011 con la caché viva.

**Qué cambió (decisión del dueño):**
- Las dos marcas de caché de Anthropic (system y historial) usan **`ttl: "1h"`**
  (`lib/ai/providers/anthropic-cache.ts`, `ANTHROPIC_CACHE_CONTROL`). Anthropic solo ofrece 5 min o 1 h; leer
  la caché reinicia su reloj sin costo.
- **Renovación de 7:00 a 22:00 (Mazatlán; las 24 horas desde el 9-oct-2026, ver abajo):** en el barrido de cada minuto del worker
  (`lib/ai/runtime/cache-keepalive.ts`, regla en `cache-keepalive-core.ts`), si la última llamada que tocó la
  caché de un modelo de Anthropic (Modelo 1 o 2) empezó hace 50–58 min, se manda una petición mínima con el
  MISMO system (`brain-system.ts`, el mismo armado que `run.ts`) y las mismas herramientas, 1 token de salida:
  solo LEE la caché (~US$0.004). Nunca escribe una caché vencida ni renueva fuera de horario; un solo intento
  por cada vez que se tocó (si falla o no la encuentra, espera a la siguiente respuesta real). El Agente IA
  contesta igual a cualquier hora.
- Registro: `ai_usage` etapa `cerebro`, resultado `cache_renovada`, sin conversación ni mensaje (no cuenta
  como respuesta; el costo estimado del selector de modelos la excluye).
- Costo: la escritura de 1 h cuesta **2× la entrada** (la de 5 min, 1.25×). `computeCostUsd` la separa con
  `usage.cache_creation.ephemeral_1h_input_tokens` del uso crudo de Anthropic (`ModelUsage.cacheWrite1hTokens`),
  así el registro del CRM sigue cuadrando con la consola.

**Estimado con las mismas 310 respuestas:** ~US$1.5/día en vez de ~US$3.0 (−51 %); la caché de 1 h sola da
−47 % y la renovación en horario suma ~US$0.13/día de ahorro.

**Ojo:** el prefijo compartido es igual en todos los chats salvo cuando cambia la lista de herramientas de un
chat (p. ej. la Tabla ya llegó a su «Máximo por chat» y su herramienta se quita): ese chat no usa la caché
común.
