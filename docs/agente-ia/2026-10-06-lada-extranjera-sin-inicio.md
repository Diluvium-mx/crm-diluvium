> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Lada extranjera: sin respuesta de inicio por palabra clave (6-oct-2026, sin migración)

Con un número de otro país (`contacts.phone_country_iso` ≠ MX), los workflows «Solo al inicio» por palabra clave
(«Información», «Precio 2», la Tabla) no salen (`onInboundKeyword`, lib/workflows/triggers.ts). Contesta el Agente IA
con CLIENTES EN EL EXTRANJERO del Goal: explica que solo se envía dentro de México y pregunta si tiene dirección en
México, antes de cotizar. Antes, el workflow mandaba el precio y el complemento del Agente IA (sin preguntas) borraba esa
pregunta. Los workflows sin «Solo al inicio» (p. ej. videos) siguen saliendo por su palabra clave.

**10-oct-2026:** la lada +1 (Estados Unidos, Canadá, el Caribe) ya no cuenta como extranjera ([2026-10-10-lada-mas-uno.md](2026-10-10-lada-mas-uno.md)).
