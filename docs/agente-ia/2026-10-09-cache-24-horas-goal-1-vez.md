> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Renovación de la caché las 24 horas y cambios del Goal una vez al día (9-oct-2026, sin migración)

- **Qué se midió (3 al 8-oct, producción):** Sonnet gastó US$5.39 en 5.3 días y el Goal completo (Goal + FAQs + tallas +
  sufijo + herramientas, ~21–24 mil tokens, ~US$0.09 cada vez) se volvió a escribir 28 veces (US$2.53, 47 %):
  11 de noche o con la primera respuesta después de las 7:00 (≈ US$5.7 al mes), 16 por guardar el Goal o las FAQs
  (`ai_knowledge_versions`: 5, 6 y 8-oct) o por despliegues que cambian el sufijo o las herramientas, y 1 por cambio
  de modelo. Las respuestas descartadas (el cliente escribe mientras contesta Sonnet) quedaron en ~US$1 al mes y no
  se tocan.
- **Renovación las 24 horas** (`cache-keepalive-core.ts`): ya no hay horario. De noche cuesta ~11 lecturas de
  ~US$0.005 (≈ US$1.6 al mes) y evita las ~2 reescrituras por noche: ahorro neto ≈ US$3.8 al mes.
- **Una renovación que reescribe la caché cuenta una vez** (`effectiveTouch`): cuando cambió el Goal, la primera
  renovación la escribe (~US$0.09) y se sigue renovando; antes se dejaba de renovar y la siguiente respuesta, si
  llegaba más de una hora después, la volvía a pagar (8-oct 13:11 y 17:39). Si dos renovaciones seguidas la
  reescriben, se para hasta la siguiente respuesta real (a lo más dos escrituras).
- **Regla del dueño:** los cambios al Goal y a las FAQs se juntan y se aplican una sola vez al día, después de las
  22:00 (Mazatlán), salvo un error grave que haya que corregir de inmediato. Cada vez que se guardan y contesta Sonnet
  se paga una reescritura; juntarlos en una sola vez evita pagar varias el mismo día (el 8-oct fueron 7).
