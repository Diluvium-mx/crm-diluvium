> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Roadmap del Agente IA (B → C → D → E)

- **Fase A (hecha):** fundación del modelo — multi-proveedor, catálogo, `ai_config`,
  pestaña "Agente IA". El agente todavía no responde.
- **Fase B (CERRADA el 24-sep-2026):** parte 1 en producción desde el 23-sep (main 65473e8) y
  parte 2 desde el 24-sep (main b66610a, migración 0026). **Prueba en vivo del dueño (24-sep,
  sandbox, +52 668 242 6364), aprobada:** texto normal; 3 mensajes seguidos → 1 respuesta;
  3 compuertas de 95 cm = talla M, 3 × $5,500 = $16,500; descuento y contra entrega sin
  pausarse; foto leída; "quiero hablar con una persona" → aviso y sigue activo; respuesta
  desde la Bandeja → pausa y "Reactivar" → vuelve. 7 llamadas al cerebro, 0 errores, $0.11 USD.
  Para afinar con el número oficial: ante "¿hacen descuento?" el Goal pide pase a humano y
  el agente respondió él mismo sin dejar aviso; "ok, gracias" no se llegó a enviar.

  Runtime que **responde por texto**, en el worker.

  **Definición del dueño (23-sep-2026, cierre de la Fase B):** el agente es el motor que hace
  que siempre haya alguien respondiendo, como Ángela en GHL. Se rige **solo** por el Goal y las
  FAQs; nada se interpone entre el agente y el cliente.
  - **Responde todo lo que entra**, sin trabas: sin borrador (ni tarjeta, ni Enviar/Descartar,
    ni modo Borrador: el canal queda **Apagado / Encendido**), sin guardia de salida, sin
    presupuesto diario y sin topes (dueño, 7-oct-2026: **nunca** un tope de respuestas). El único
    freno es el de contestadores automáticos (abajo, 7-oct-2026). El gasto lo controlan las llaves de
    OpenAI/Anthropic y el saldo del Dashboard. La migración 0025 apagó los canales que estaban
    en borrador, descartó los borradores vigentes y levantó las pausas viejas.
  - **Pausa:** SOLO cuando un vendedor contesta en la conversación (Bandeja, pop-up del Embudo,
    programado o, con el número real, la app del celular). Se reactiva solo a mano con
    "Reactivar" (Bandeja o Detalle del contacto). Nada más pausa.
  - **Freno ante contestadores automáticos (7-oct-2026, caso Estafeta;
    `lib/ai/runtime/contestador.ts`):** el WhatsApp de Estafeta le mandó al número un aviso con
    botones (Meta lo pasa como «no compatible», 131051); el Agente IA saludó y el contestador de
    Estafeta respondió «Perdón, no estoy seguro de haber entendido bien…» más su menú, 102 veces en
    78 minutos (se detuvo solo porque fallaron los dos modelos). Regla: si en las últimas **3
    vueltas** que contestó el Agente IA el contacto **solo** mandó lo mismo que ya había mandado
    (texto idéntico de 20 letras o más, sin importar mayúsculas ni espacios) o avisos que WhatsApp
    no deja ver, el Agente IA **no contesta** (no llama al modelo), se **pausa hasta «Activar»**
    (`pausado_humano`, Historial `pausa_bucle`) y deja el aviso 🤖 `contestador` (tarjeta amarilla
    en el Embudo hasta «Activar»). No cuentan como «nada nuevo»: textos cortos repetidos («sí»,
    «ok»), fotos, audios o archivos, ni lo que Instagram no deja ver. Un vendedor que contesta en
    medio o un «Activar» vuelven a empezar la cuenta. En esa pausa un seguimiento no sale solo:
    queda como sugerencia, como con «Pausar agente» puesto a mano (despertaría otra vez al
    contestador). Simulado sobre los 1,806 chats de producción (7-oct): solo el de Estafeta la
    cumple (se habría frenado a las 08:37 con 5 respuestas en vez de 102).
  - **Pase a humano:** el agente le dice al cliente que un vendedor lo atenderá (o le enviará
    los datos bancarios), deja un **aviso visible en la Bandeja** (`ai_agent_notices`) y sigue
    activo hasta que un vendedor conteste. La señal `[TRANSFERIR]` nunca llega al cliente.
  - **Historial:** el cerebro lee **toda** la conversación. Protección técnica: si un chat no
    cabe en el modelo (~300 mil caracteres), toma lo más reciente sin fallar; un mensaje pegado
    enorme se recorta a 4,000 caracteres y van como imagen las 20 fotos más recientes.
  - **Mensajes para celular** (formato del Goal): información y pregunta separadas por línea en
    blanco → 2 mensajes (primero la información) con pausa de 1.5 s; bloque corto → 1 mensaje;
    bloque largo (> 320 caracteres) → 2 mensajes cortados entre oraciones.
  - **Espera para juntar mensajes seguidos:** 15 s fija (tope 60 s desde el primero), interna.
  - **Filtro (GPT-5.6 Luna):** no deja a nadie sin respuesta. Solo limpia la metadata del
    anuncio de Click-to-WhatsApp (`lib/ai/runtime/ad-cleaner.ts`): el cerebro recibe solo lo
    que escribió el cliente y el resumen del anuncio queda guardado en el mensaje
    (`metadata.agenteAnuncio`). Sin anuncio no se llama; si falla, un respaldo sin modelo.
  - **Cerebro:** Goal completo + las 47 FAQs activas (cacheados). El runtime solo agrega: qué
    devolver (solo el texto para WhatsApp), cómo activar "Transferencia a humano" / "Datos
    bancarios" (`[TRANSFERIR]`) y que tablas, videos y cambios de etapa aún no existen.
  - Etiquetas internas "pasar a humano" / "revisión humana": ya no se crean y no se muestran.

  **Robustez (revisiones de Claude, cyber-neo y Codex, 23-sep-2026):**
  - **OFF no toca nada:** los ganchos de la ingesta y del envío solo LEEN con el canal
    apagado; todo va en try/catch y la ingesta aísla los ganchos
    (`lib/ai/runtime/isolation.int.test.ts`). Filtro por organización en todo el runtime.
  - **Idempotencia y cortes:** un entrante ya atendido no se vuelve a contestar; encender el
    canal o "Reactivar" es corte (no contesta historia); el barrido rescata entrantes sin job de
    los últimos 30 min. Un cliente que escribe durante la generación hace que la respuesta se
    descarte y se regenere con TODO (máx. 3 rondas; luego vuelve a la espera, nunca en bucle).
  - **Envío sin carreras:** antes de CADA mensaje se relee el estado; si un vendedor responde o
    pausan/apagan al Agente IA, el resto ya no sale y queda en una tarjeta con el texto. Si el
    cliente escribe cuando ya salió el 1.er mensaje, la respuesta se termina (5-oct-2026, ver
    «Respuesta que ya empezó se termina»); antes del 1.er mensaje se descarta y se regenera. Un envío en camino detiene los
    siguientes y el agente no responde encima. Una respuesta de 2 mensajes guarda antes un
    **plan durable**; si el worker se reinicia a la mitad, el barrido lo concilia por
    `created_at` ≥ `resolved_at` (los dos con el reloj de Postgres): nada salió → el entrante se
    vuelve a atender; salió una parte → aviso con lo que faltó (nunca se reenvía: podría
    duplicar). Un envío fallido o sin confirmar deja un aviso por mensaje.
  - **Límite de Zernio (429; Bloque B, 28-sep-2026):** no es un fallo. La burbuja o el archivo del
    workflow espera su turno (lo que diga Zernio, tope 5 min) y sale con la misma clave; no hay
    tarjeta "El agente no pudo responder" ni corrida fallida por eso. Las burbujas y los archivos
    salen en orden dentro de la conversación (`lib/messaging/send-turn.ts`, `docs/bandeja.md`).
  - **Datos bancarios (/banco o agente) que no llegan (Bloque B):** si el worker se reinicia a la
    mitad, al retomar solo cuenta como enviado lo que WhatsApp confirmó (enviado/entregado/leído); un
    archivo fallido detiene la corrida, **no** mueve a Cerca de compra y deja la tarjeta con el
    motivo. Si WhatsApp lo acepta y minutos después avisa que falló (p. ej. 131053), queda la tarjeta
    «No le llegó al cliente la imagen de Datos bancarios: <motivo>. Vuelve a mandarla con /banco.»
    (`lib/workflows/delivery-notice.ts`); la etapa no se regresa.
  - **AUTO con clientes reales (número real):** bloqueado hasta el approve de Codex del agente
    completo. En el sandbox (solo el teléfono del dueño) está autorizado.
  - **Antes de clientes reales** (no dañan a un cliente hoy; no abren ronda):
    - ~~Sin frenos, un bucle con otro contestador automático (dos agentes contestándose) gastaría sin límite hasta
      que alguien lo note en el Dashboard; el cliente escribiendo sin parar solo retrasa.~~ Pasó el 7-oct-2026
      (Estafeta) y se resolvió con el freno ante contestadores automáticos (arriba).
    - El cerebro ya no tiene la regla de no revelar sus instrucciones (no está en el Goal): un
      cliente podría pedírselas.
    - Conciliación de planes por hora de Postgres y no por id de plan en cada mensaje.
    - ~~El barrido de avisos de envíos fallidos recorre `messages` cada minuto sin índice propio.~~ Resuelto
      28-sep-2026: migración 0044 (`messages_created_idx`).
    - Informativo: la conversación (con datos del cliente) y URLs firmadas de imágenes van a
      OpenAI/Anthropic; CLAUDE.md §4 dice "solo GitHub, Railway y Meta" (decisión del dueño).

  **Migración de la Fase B (resuelto 23-sep-2026):** la migración del runtime es la
  `0024_agente_ia_runtime` (regenerada sobre main da53cc4, `when` posterior a la 0023 de
  main). El aviso viejo de una "0014" aplicada en staging ya no aplica: el 23-sep staging
  tenía 24 migraciones (hasta la 0023 de main), solo `ai_config`/`ai_knowledge` y ningún
  canal encendido; la 0024 crea sus tablas y columnas sin chocar.
- **Fase B, parte 2 (24-sep-2026, en main b66610a, rama `feat/agente-ia-editor`, migración
  `0026_agente_editor_y_saldo`):** la pestaña "Agente IA" pasa a ser el editor estilo GHL
  (ver "Qué hay"), el Detalle del contacto muestra "Llegó por anuncio" y el Dashboard muestra
  el gasto del mes y el saldo estimado por proveedor. La 0026 solo AGREGA: tablas
  `ai_knowledge_versions` y `ai_credit_topups`, y columnas `ai_config.agent_name` (default
  "Ángela") y `ai_config.company_name`. No cambia datos existentes. La **0027** queda
  reservada para la Fase D.
  - **Valores personalizados:** el runtime sustituye `{{contacto.nombre}}`,
    `{{vendedor.nombre}}`, `{{empresa.nombre}}` y `{{agente.nombre}}` en el Goal y en las
    FAQs por conversación, antes de llamar al cerebro. El Goal y las 47 FAQs de producción
    no tenían llaves `{{…}}` al 24-sep-2026 (ni las copias del Goal del 27-sep): el cerebro
    recibe exactamente lo mismo que antes. Desde el 28-sep-2026 ya no hay botón para
    insertarlas (solo a mano). Ojo: el nombre del agente (✎) solo llega al modelo por
    `{{agente.nombre}}`; con el Goal de hoy, cambiarlo no cambia cómo se presenta.
  - **Versiones:** cada guardado del Goal y cada cambio de FAQs (agregar, editar,
    activar/desactivar, borrar, restaurar) deja una foto completa en `ai_knowledge_versions`;
    la primera vez guarda también la anterior. "Restaurar" deja, a su vez, otra versión.
  - **Nombre del agente y de la empresa** se guardan cada uno por separado (cambiar uno no
    regresa el otro a un valor viejo).
  - **Saldo estimado:** recargas registradas − `ai_usage.cost_usd` desde el día (hora de
    Mazatlán) de la primera recarga del proveedor. Es un estimado: depende de los precios
    internos (`lib/ai/pricing.ts` + `ai_model_prices`) y no incluye impuestos.
  - **Sin gasto de pruebas (decisión del dueño, 24-sep-2026):** se quitó por completo el "gasto
    dividido" (la tarjeta leía el gasto de staging por `GET /api/internal/ai-spend`). Ya no existe
    el endpoint ni el lector: la tarjeta muestra solo el gasto del mes por proveedor y el saldo
    estimado = recargas − gasto de producción. `AI_SPEND_TOKEN` y `STAGING_APP_URL` ya no se usan
    (si se llegaron a poner en Railway, se pueden borrar).
  - **Seed del conocimiento:** desde que existe el editor, `npm run seed:ai-knowledge` se
    niega a correr si la organización ya tiene versiones (el Goal o las FAQs se editaron en
    la pestaña): pisaría lo editado sin dejar versión. `SEED_FORCE=1` lo obliga.
  - **Revisión de Codex (24-sep-2026), bajos que no abren ronda:**
    - El saldo se calcula por organización, pero la llave del proveedor es global: lo que
      gasten staging u otra app con la misma llave no se descuenta. La pantalla lo aclara.
    - Registrar una recarga no es idempotente: si se pierde la respuesta y se captura otra
      vez, queda duplicada (se ve en la lista y se borra con "Borrar").
    - `{{vendedor.nombre}}` ya ignora a un vendedor desactivado ("un asesor"); en v1 las
      conversaciones no tienen asignado, así que hoy siempre sale "un asesor".
- **Fase C:** follow-ups automáticos — "ocupado" a las 2h; "dejó de responder" a los
  4 días con plantilla fuera de la ventana de 24h; horario 8:00–17:00.
- **Fase D (CERRADA el 25-sep-2026; en producción desde main 057725c, migración 0031):** el cerebro recibe herramientas en la misma llamada
  (AI SDK `tools` sin `execute`, una vuelta): `wf_<slug>` por cada workflow de media habilitado
  (Automatización), `fijar_cotizacion`, `mover_etapa` (solo hacia adelante; la etapa del vendedor manda) y
  `aviso_vendedor` (cotejar_deposito | cliente_pide_humano | comprobante_dudoso → aviso 🤖 en la Bandeja,
  nunca pausa). El CRM no verifica montos: el agente decide con su Goal y su lectura de la imagen o PDF;
  el CRM guarda el comprobante leído (`comprobantes`) y avisa si la referencia ya se usó con otro
  contacto. Contexto del CRM (etapa, cotización, comprobantes) al final del último turno del cliente.
  Diseño y texto del Goal: `docs/fase-d-diseno.md` §10. **Prueba B5 en producción (25-sep):** pasaron
  los pasos 1, 3, 4 y 5; el 2 y el 6 con observaciones. El Goal de producción es la versión 2 del
  historial. Pendientes A–F (sin construir) y resultado completo: `docs/fase-d-diseno.md` §11.
- **Fase E (CERRADA el 26-sep-2026, main ebcd981; definición del dueño del 25-sep):** Modelo 1 (Luna) y Modelo 2 (Sonnet 5) por etapa,
  cada uno con su selector en la pestaña Agente IA, más el reenvío seguro. **Hecho en la rama
  `feat/agente-ia-fase-e` (migración 0033):** los dos selectores y la asignación por etapa
  (Modelo 1 = Inbox, Prospecto e Interesado, decisión del dueño), adaptadores de Google, xAI y
  OpenRouter con sus precios, tope de 4,096 tokens con aviso si se corta (parte del pendiente B
  de la Fase D), sin sección "Empresa" y favicon nuevo (main 0f495e9). **Parte 2 (migración 0034):**
  - **Reenvío seguro** (definición del dueño, 25-sep): si el modelo falla, el CRM NO lo vuelve a
    llamar solo. Deja en el chat la tarjeta ⚠ 🤖 "El agente no pudo responder" con el error en
    palabras simples (sin saldo, llave faltante o inválida, proveedor saturado, tardó demasiado,
    rechazó la conversación, respuesta vacía; `lib/ai/runtime/model-errors.ts`) y los botones
    **Reintentar** (un intento más, ya) y **Apagar** (pausa al agente solo en esa conversación;
    "Reactivar" lo regresa). Mientras nadie elija, ni mensajes nuevos, ni la cola, ni el barrido
    vuelven a llamar al modelo ahí. Única excepción: si el proveedor está **saturado** se reintenta
    UNA vez sola tras 10 s. Los adaptadores ya no usan los reintentos ocultos del SDK (`maxRetries: 0`).
  - **"Depósito recibido"**: el aviso de pago es un texto fijo, sin montos, folio ni texto del modelo.
    El agente ya no anota monto/folio y se quitó el chequeo de folio repetido (decisión del dueño);
    la tabla `comprobantes` queda sin uso. El contexto del CRM ya no lista comprobantes.
  - **Caché del historial** (Anthropic): segundo punto de caché antes del último turno del cliente;
    probado con Sonnet 5 real: la 2.ª llamada leyó de caché 4,931 de 4,962 tokens de entrada.
  - La nota "ya salió por palabra clave" solo queda en el log del worker (ya no es aviso al vendedor).
  - Revisión adversarial de Claude (Codex sin sesión el 25-sep): una tarjeta VIEJA ya no bloquea
    tras "Reactivar" o tras encender el canal (solo bloquea si es posterior al último cambio de
    estado); cuando el agente vuelve a contestar, las tarjetas abiertas quedan "superadas"; no hay
    tarjeta si durante la falla un vendedor contestó o pausaron al agente; "Reintentar" que no
    pudo programar la corrida reabre la tarjeta; "Apagar" pausa antes de cerrar la tarjeta; el
    aviso automático al mover a Compra sin comprobante es neutral y no sale junto a "Comprobante
    dudoso"; el punto de caché de Anthropic va antes de la primera foto o PDF (su URL firmada
    cambia en cada respuesta y la caché no se reutilizaría).
  - Llaves con los nombres de Railway: `GEMINI_API_KEY`, `GROK_API_KEY`, `QWEN_API_KEY` (valor en
    el web de producción; `worker-production` las referencia). Prueba real del 25-sep: Gemini y
    Qwen contestan con herramientas; Grok rechazó la llave (hay que volver a copiarla).
  **Parte 3 (25-sep, migración 0035):**
  - **A resuelto:** la conversación para el modelo SIEMPRE termina en el turno del cliente; lo que
    salió por palabra clave después de su mensaje va como nota ("[Después de este mensaje ya se le
    envió al cliente: …]"). Probado con Sonnet 5 real: antes daba el 400 de B5; ahora contesta el
    precio y no repite el video.
  - **Falla al ENVIAR:** si el CRM (ventana cerrada, canal apagado) o WhatsApp rechazan el primer
    mensaje, sale la tarjeta con el motivo y "Reintentar"/"Apagar"; antes la cola reintentaba hasta
    3–5 veces pagando otra llamada al modelo cada vez y dejando burbujas fallidas.
  - **Tope diario de $20:** el dueño decidió quitarlo. La columna `ai_config.daily_budget_usd` se
    borró en la `0037_agente_parte_1` (26-sep-2026).
  - **Dashboard:** "Gasto de IA" hasta arriba con cifras grandes y los cinco proveedores con llave.
  - Decidido NO hacer: indicador "agente con error" en la lista de la Bandeja (el dueño no lo ve probable).
  - **Cierre (26-sep):** Grok funciona (la llave había perdido el guion de `xai-`; tras corregirla en el web
    hubo que volver a desplegar `worker-production`: una variable referenciada solo le llega al worker
    cuando él se despliega). Recargas de saldo: **manuales** desde la página de cada proveedor, sin botón
    en el CRM (xAI y OpenRouter lo permitirían por API; decisión del dueño). La revisión de Codex de las
    tres partes va como penúltima acción antes de conectar el número oficial. El panel de gasto que antes
  se anotaba aquí ya existe en el Dashboard (24-sep-2026); conciliar contra las Cost API queda como
  pendiente sin fase.
