# Palabra suelta sin sentido = texto interno (12-oct-2026, sin migración)

**Qué pasó.** El 10-oct a las 3:29 p.m. GPT-5.6 Luna contestó «¿Hasta qué altura aproximada le llega el agua?» y,
en la misma respuesta, «Winvalid» como burbuja aparte. Salió al cliente: está en letras latinas y ninguna regla de
`lib/ai/runtime/internal-text.ts` la veía. Antes ya había salido «ileswi» como renglón solo.

**Revisión en producción (12-oct).** En TODOS los mensajes del Agente IA, los renglones de una sola palabra fueron:
«Winvalid», «ileswi», «[actions]», «😊», «屹», «娱乐平台招商» y enlaces. Ninguna palabra buena.

**Regla.** Un renglón que es UNA palabra en letras latinas (con o sin signos: «¡Claro!», «Perfecto.») es texto
interno, salvo una lista corta de cortesías (claro, perfecto, gracias, listo, sí, ok, hola…). Emojis, números,
enlaces y letras de otro alfabeto no cuentan (las de otro alfabeto se siguen borrando, decisión del 6-oct).
Como todo texto interno: el CRM pide otra respuesta al mismo modelo una vez
([reintento del 10-oct](2026-10-10-texto-interno-reintento.md)); si vuelve a fallar, tarjeta y pausa.
