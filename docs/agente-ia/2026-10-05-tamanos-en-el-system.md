> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Tamaños en el system (5-oct-2026)

Pedido del dueño: que el Agente IA no invente nada. Revisión de chats: 7 de 39 tamaños dichos en el chat salieron mal
(90 cm → M en vez de CH, 99 → G en vez de M…) aunque el Detalle mostraba el correcto. Causa: Tallas y medidas solo
alimentaba el «tamaño sugerido» del Detalle; al modelo nunca le llegó la tabla estándar, solo la de la mini que está en
el Goal, y con esa asignaba también la estándar.

- `loadBrainSystem` (`brain-system.ts`) lee `tallas_compuerta` y `buildBrainSystemWithRuntime` (`brain.ts`) agrega la
  sección **TAMAÑOS** (`sizesInstructions` en `lib/contacts/sizes.ts`) después de las FAQs y antes del sufijo del CRM:
  una línea por línea de compuerta (estándar primero), con cada tamaño y su rango en cm. Sin rangos, el system queda
  igual que antes.
- Una sola fuente: lo que se edite en Tallas y medidas le llega al agente en la siguiente respuesta (la caché del system
  se reescribe una vez). La renovación de la caché usa el mismo armado, así que sigue manteniendo viva la misma entrada.
- El Goal debe decir «usando la sección TAMAÑOS» y no traer su propia tabla (cambio del Goal aparte, con OK del dueño).
