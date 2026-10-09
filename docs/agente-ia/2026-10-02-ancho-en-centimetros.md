> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Ancho de las entradas siempre en centímetros (2-oct-2026, sin migración)

Pedido del dueño (captura del Detalle con «Entrada 1: 175» sin unidad): que se vea qué medida es, definida por lo que dijo
el cliente y lo que interpreta el Agente IA (no un selector), y que un número sin unidad como 230 sean centímetros, nunca
metros.

- **Detalle:** el ancho de cada entrada lleva «cm» a la derecha, como «¿Cuánta agua entra?». Se guarda siempre en cm
  (`contact_entradas.ancho_cm`) porque los rangos de Tallas y medidas son en cm y de ahí sale el tamaño sugerido.
- **Agente IA y lector** (misma frase, `ANCHO_EN_CM` en tools.ts; la usan `actualizar_detalle` y el lector en segundo
  plano): convierte lo que dijo el cliente — metros × 100 (1.75 m, «1.75» o «1 metro 75» = 175), pulgadas × 2.54 (70
  pulgadas = 178); un número sin unidad de 10 o más ya son centímetros (230 = 230 cm, nunca metros).
- **Red de seguridad** (`parseDetalle`): un ancho de menos de 10 son metros que el modelo no convirtió (1.75 → 175 cm).
  Antes se redondeaba y quedaban 2 cm. En producción (2-oct) los 46 anchos guardados ya estaban en cm (70–405).
