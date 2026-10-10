> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## La lada +1 cuenta como de México (10-oct-2026, sin migración)

**Origen:** a un cliente con número de Estados Unidos (+1) el Agente IA le mandó el mensaje de envíos internacionales al
primer «¿Cómo funciona?», porque el CRM le decía «Lada del número del cliente: Estados Unidos (+1), fuera de México» y el
Goal aplicaba CLIENTES EN EL EXTRANJERO. Muchos clientes que viven en México usan un número de allá.

**Decisión del dueño:** cualquier número +1 (Estados Unidos, Canadá, el Caribe) cuenta como de México.

- `foreignLadaLine` (lib/phone.ts) devuelve null con la lada +1: el contexto del CRM ya no dice «fuera de México» y las
  respuestas «Solo al inicio» por palabra clave salen igual que con cualquier cliente
  ([2026-10-06-lada-extranjera-sin-inicio.md](2026-10-06-lada-extranjera-sin-inicio.md)).
- Las demás ladas extranjeras siguen igual.
- El Goal no cambia: CLIENTES EN EL EXTRANJERO sigue aplicando cuando el cliente dice que está fuera de México o hay
  indicios claros (precio en dólares, una ciudad de allá).
- La ubicación del encabezado del chat («📍 Estados Unidos») sigue saliendo de la lada: solo informa.
