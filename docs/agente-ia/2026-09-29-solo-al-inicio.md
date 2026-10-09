> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## «Solo al inicio» (29-sep-2026, migración 0048)

- **Pedido del dueño:** «Precio 2» es la respuesta ya definida para quien llega de un anuncio y su primer mensaje
  es "precio"/"costo". Datos de prod (26–29 sep): de 24 disparos por palabra clave, 14 fueron al inicio (bien) y el
  resto a media conversación ("Cada una cuesta 5.500 pesos", "La mediana que precio tiene"): ahí el guion no encaja.
- **Regla ESTRICTA** (`workflows.trigger_start_only`, `lib/workflows/start-only.ts`), opción del editor
  «¿Cuándo se dispara por palabra clave o por el Agente IA?» → «En cualquier momento» (como antes) o «Solo al inicio»:
  - Solo sale **al inicio**: mientras no haya un saliente que cuente como respuesta: de un vendedor (`crm`,
    `business_app`, incluido el historial copiado del celular) o del Agente IA con **texto propio** (`ai_agent` que no
    es de una corrida de workflow). Lo que mandan otros workflows no cuenta: «Información» y luego "Precio" sí dispara.
  - **Una sola vez por contacto**, por cualquier camino y en cualquier conversación (corrida en cola/corriendo/hecha
    o que ya mandó algo). Nunca se repite.
  - Se aplica a palabra clave y Agente IA (herramienta y etapa movida por el agente). El **comando del vendedor** y
    la etapa que mueve un vendedor salen siempre.
- **Dónde se revisa:** al elegir la palabra clave (`onInboundKeyword`: el que ya no aplica no compite y el mensaje
  puede disparar otro que coincida), al ofrecer herramientas al Agente IA (`loadAgentTools` con la conversación: solo
  se ofrece mientras aplica), al crear la corrida (`startWorkflowRun`, omitida con `ya_no_es_el_inicio` o
  `ya_enviado_a_este_contacto`) y otra vez al arrancar (`executeWorkflowRun`, paso 0: si dos corridas del mismo
  workflow llegan juntas —palabra clave y agente— gana la primera que arrancó).
- **Pendiente (otro chat, análisis del flujo del Agente IA):** «El workflow es la respuesta» — qué hace el agente con
  su propio texto cuando usa un workflow así como herramienta (hoy salen los dos). → Resuelto el 29-sep (sección
  siguiente).
