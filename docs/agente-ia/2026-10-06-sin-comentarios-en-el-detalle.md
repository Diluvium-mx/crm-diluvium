> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Sin comentarios en el Detalle (6-oct-2026, sin migración)

Pedido del dueño: ningún vendedor veía la sección Comentarios del Detalle. Se quitó la sección (y sus acciones de
servidor), y el Agente IA y el lector ya no escriben ni leen comentarios: `actualizar_detalle` y la herramienta del
lector ya no tienen el campo `comentario`, y el contexto del CRM ya no trae «Comentarios que ya guardaste». Si un
modelo manda el campo, se ignora. Los 800 comentarios guardados (casi todos del Agente IA) siguen en
`contact_comentarios`; no se borran. Lo de arriba sobre comentarios (26-sep) queda como historia. Costo que se ahorra:
la salida del comentario (~30 tokens cada uno, unos 670 por semana) y hasta 5 comentarios en la entrada de cada
llamada; del orden de US$1–2 al mes. El lector, cuando el cliente cambia lo que pide y el precio nuevo nunca se dijo,
ya no deja el comentario «falta confirmar el total»: solo no manda monto.
