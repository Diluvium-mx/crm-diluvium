> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Seguimiento rechazado por el tope de Meta (131049): sin tarjeta ni pausa (19-oct-2026, sin migración)

**Qué pasó:** Meta no entrega una plantilla de marketing a quien ya recibió muchas promociones de todas las empresas
(error 131049). Del 1 al 19-oct pasó con 11 de ~1,390 seguimientos (0.8 %), casi todos en el 2.º o 3.er intento,
con el cliente 8 días o más sin escribir. El diseño de [seguimientos](../seguimientos.md) decía «aviso, sin reintento»,
pero el barrido de respuestas rechazadas (`sweep.ts` › `noticeFailedAgentSends`, regla del 5-oct) toma todo mensaje
fallido del Agente IA como una respuesta que el cliente esperaba: dejaba la tarjeta «WhatsApp rechazó una respuesta
del Agente IA (código 131049)» y pausaba al Agente IA. Del 16 al 19-oct quedaron 7 chats pausados; si el cliente
escribía, nadie le contestaba, y el siguiente seguimiento solo quedaba como sugerencia.

**Cambio (OK del dueño, 19-oct):** el barrido salta los mensajes con error 131049 (solo le pasa a una plantilla de
marketing, es decir, a un seguimiento). Sigue anotado en el intento («no salió · motivo» en la burbuja 🤖, como antes),
sin reintento, y el siguiente intento sigue su calendario. Cualquier otro rechazo (131047, 131026, sin confirmar…)
deja la tarjeta y la pausa como siempre.

**No cambia:** 131050 (el cliente se dio de baja de promociones) sigue como estaba. Las tarjetas que ya existían se
atienden a mano (Reintentar).

**Vigilar en prod:** tarjetas `agente_error` con «131049» (deben ser 0) y que el seguimiento siguiente del mismo contacto
salga en su fecha.
