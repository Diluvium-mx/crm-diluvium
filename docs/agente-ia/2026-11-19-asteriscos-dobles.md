> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Asteriscos dobles: se borran antes de enviar (19-nov-2026, sin migración)

Propuesta A de otro chat, revisada y aprobada por el dueño para el mismo OK MAIN que [Luna callada](2026-11-19-luna-callada.md).

### Qué pasaba

- GPT-5.6 Luna a veces resalta con negritas de Markdown lo que quiere destacar: el precio, el teléfono 668 241 9579, la
  medida, la garantía o el nombre para buscar en Mercado Libre («**$5,500**»). Revisión de producción (19-nov): **93
  mensajes en 18 chats** desde el 3-oct; 91 de Luna, 2 sin modelo registrado, **Sonnet nunca**. 33 eran de un solo chat
  del 7-oct. En octubre salía en el 0.1–0.3 % de los chats y en noviembre en el 1.2–1.7 %, pero en número de chats es
  casi igual (bajó el total de chats del fin de temporada); no coincide con ningún cambio del CRM.
- WhatsApp no los vuelve negritas (el cliente ve los asteriscos) y en la Bandeja salen tal cual.
- Se repite en el mismo chat: Luna los ve en el historial y los copia (un chat, 6 veces del 14 al 17-nov).
- Descartado como origen: Goal, FAQs, reglas de etapa, workflows, mensajes rápidos, links de pago, tallas, textos de
  anuncios y el aviso del Buen Fin (ninguno trae asteriscos dobles).

### Qué cambia

- Antes de enviar, el CRM **borra los asteriscos dobles** (dos o más seguidos, también «***») y el texto sale igual:
  «cuesta **$5,500**» → «cuesta $5,500». Los espacios que dejan se juntan. Un **asterisco solo** (la negrita de
  WhatsApp, «*Tamaño M:*») no se toca.
- Dos puntos, igual que las letras de otro alfabeto: al leer la respuesta del modelo (`run.ts`, también en la segunda
  vuelta de Luna callada) y otra vez en la puerta de envío (`lib/messaging/send.ts` › `agentLanguage`), que cubre todo lo
  que sale a nombre del Agente IA: respuestas, «Reintentar», textos y pies de workflows y seguimientos.
- Lo guardado en el chat ya va limpio: Luna deja de ver asteriscos nuevos en el historial para copiarlos.
- Lo que escribe un vendedor no se toca.
- Sin tarjeta, sin pausa, sin otra llamada al modelo. Costo US$0. No toca Goal ni FAQs (la caché no se vuelve a cobrar).

**Por qué en código y no en el Goal:** con Luna las instrucciones solas no bastan (se vio en Luna callada) y cambiar el
Goal o las reglas del CRM vuelve a cobrar la caché de Sonnet.

**No debilita el candado de texto interno:** «**(sin acción adicional…)**» sigue siendo «nota entre paréntesis» y
«**Winvalid**» sigue siendo «palabra suelta»; «**Dirección:**» queda «Dirección:» y pasa como antes.

### Código y pruebas

- `lib/ai/runtime/internal-text.ts` › `stripDoubleAsterisks` / `hasDoubleAsterisks`; `run.ts` (después de las letras de
  otro alfabeto); `lib/messaging/send.ts` › `agentLanguage`.
- `internal-text.test.ts` (casos reales, triples, espacios, un asterisco solo intacto, candado intacto),
  `send-agent.int.test.ts` (puerta de envío; vendedor sin tocar) y `run.int.test.ts` (respuesta y segunda vuelta de
  Luna callada sin asteriscos).

**Cómo verlo en producción** (con «OK LECTURA PROD»): mensajes salientes con `source = 'ai_agent'` y `body like '%**%'`
después del despliegue = 0. En el registro del worker: «escribió asteriscos dobles (**); se borran».
