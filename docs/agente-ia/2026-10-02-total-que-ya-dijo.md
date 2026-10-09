> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## El total que la empresa ya dijo también se fija (2-oct-2026, sin migración)

Revisión de producción del 2-oct: 33 avisos «Acción del agente no ejecutada: fijar_cotizacion ignorada: $5500 no aparece
en el texto del agente» desde el 27-sep (15 el 1-oct), 29 seguían como **tarjeta amarilla** en el Embudo sin nada que
atender. En 31 de los 33 el total **sí se le había dicho al cliente**: casi siempre «Precio 2» o «Información» por palabra
clave («Ahorita tenemos cualquier tamaño en $5,500…») y el Agente IA, en complemento, no tenía nada que agregar o contestó
otra cosa sin repetir el precio. El CRM solo aceptaba el monto si venía en el texto propio del agente.

- **Regla nueva** (`quoteBacked` en actions.ts): se fija si el agente lo dice en su texto **o** si sale de los precios que
  la **empresa** (Agente IA, workflows, vendedor) ya le dio al cliente en el chat que leyó el modelo: la cantidad o la suma
  de hasta 4 (2 × $5,500), la misma regla que el lector en segundo plano (`amountsIn` / `isBackedAmount`, lector-core.ts).
  Lo que **dicta el cliente** sigue sin contar (la inyección de cotización de la Fase D, fase-d-diseno.md §8.3).
- Si el total no sale de ningún precio de la empresa, se ignora como antes y queda el aviso («…no aparece en el texto del
  agente ni sale de los precios que la empresa le dio en el chat»). De los 33 del histórico, 2 seguirían así.
- **Monto de un vendedor:** igual que antes, el del agente solo lo reemplaza si su respuesta salió (si no le escribió nada
  al cliente en esa respuesta, se queda el del vendedor).
