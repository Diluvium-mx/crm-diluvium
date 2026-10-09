> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Nota para la Fase B (panel de gasto)

El runtime del Agente (Fase B) **debe PERSISTIR tokens/uso por mensaje procesado**
(input, output, caché read/write, modelo, proveedor). `callModel` ya devuelve ese
`usage` normalizado (`ModelUsage`); falta escribirlo por mensaje en la base cuando
el agente responda de verdad. Eso alimenta un **panel de gasto** futuro (no se
construye ahora). **Hecho:** el runtime escribe `ai_usage` por llamada (23-sep-2026) y el
Dashboard ya muestra el gasto del mes y el saldo estimado (24-sep-2026).
