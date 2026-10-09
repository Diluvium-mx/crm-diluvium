> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Pregunta duplicada: workflow por palabra clave + Agente IA (28-sep-2026)

- **Incidente (prod, 28-sep 6:27–6:49 p.m. Mazatlán):** «Información» y «Precio 2» (igual que GHL) terminaban con
  «¿Usted tiene problemas de inundaciones?», la misma pregunta que pide el Goal. Como lo que manda un workflow por
  palabra clave no cerraba el mensaje del cliente (regla del 24-sep: "el agente contesta el resto"), el Agente IA
  contestaba el mismo mensaje y repetía la pregunta aunque la nota «ya se le envió» se la decía (Luna la ignoró).
  3 chats en 20 min: Caba Decor Y Estilo y Maria Verdugo (idéntica), Maria (parafraseada). Ese día se quitó la
  pregunta de los dos workflows.
- **Regla nueva (OK del dueño):** si el **último paso** de un workflow por palabra clave es una **pregunta** (texto
  o pie del archivo que termina en "?", `endsWithQuestionStep`), esa pregunta **contesta** el mensaje que lo disparó:
  el ejecutor la marca con `respondeHasta` = hora de ese mensaje, así que lo que el cliente escribió **después**
  sigue pendiente y el agente lo contesta. Mientras la corrida va en camino, el agente **espera** (vuelve a mirar
  cada 5 s, tope 3 min) en vez de contestar encima. Los workflows que NO terminan en pregunta (solo foto/video)
  siguen igual: el agente contesta el resto.
- **Candado anti-repetición** (`lib/messaging/repeat.ts`): ni el agente ni un workflow suyo (corrida del agente o
  por palabra clave) mandan un texto **idéntico** (sin importar mayúsculas ni espacios) a uno que ya salió después
  del último mensaje del cliente. Si ninguna burbuja queda, es como una respuesta de solo acciones; queda en
  `ai_usage.error` ("no se repitió lo que ya salió"). El comando o la etapa de un vendedor salen siempre.
- **Costo aceptado:** si el cliente pregunta dos cosas en el MISMO mensaje ("precio y envían a Monterrey?") y el
  workflow que dispara termina en pregunta, lo segundo espera a que el cliente conteste (como en GHL).
- **29-sep-2026:** la regla automática «termina en pregunta» la reemplazó la casilla «El workflow es la respuesta», y la
  marca `respondeHasta` de la palabra clave cambió a `contestaA` (solo el disparador; bug de la ráfaga). Ver la sección
  «Tabla de tamaños, «Máximo por chat» y «El workflow es la respuesta»».
