> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Lada extranjera, un solo aviso «pide una persona» y silencio ante un acuse (6-oct-2026, sin migración)

Caso real (4-oct): un cliente de España (+34) fue calificado y cotizado como si fuera de México; al pedir el enlace de
tarjeta, el Agente IA dejó 4 avisos en 3 minutos y contestó 5 veces casi lo mismo a «Vale», «Vale», «Ok».

- **Lada en el contexto del CRM** (`crmContextFor`, actions.ts; `foreignLadaLine`, lib/phone.ts): si la lada del
  contacto (`contacts.phone_country_iso`) no es de México, el último turno lleva «Lada del número del cliente: España
  (+34), fuera de México.». Con lada mexicana o sin teléfono (Instagram) el contexto queda igual. Va en el contexto, no
  en el system: la caché no cambia. Qué hacer lo dice el Goal (CLIENTES EN EL EXTRANJERO).
- **Un solo aviso «El cliente pide hablar con una persona» abierto por chat** (`hasOpenHandoverRequest`, notices.ts):
  abierto = sin resolver y sin un saliente humano (CRM o celular) después de él. Mientras lo esté, los siguientes no se
  crean; el cliente sigue recibiendo su respuesta. Cuando un vendedor contesta, el próximo pedido deja aviso nuevo.
- **Silencio ante un acuse** (run.ts): si todo lo pendiente del cliente es un acuse (`isBareAck`: «ok», «vale»,
  «gracias», emoji, sticker), `[NADA_QUE_AGREGAR]` cuenta como «no contestar»: no sale nada, no se llama a otro modelo ni
  hay tarjeta (registro: «sin texto: el cliente solo confirmó o agradeció»). Fuera de un acuse (o del complemento de un
  workflow) la señal sigue siendo respuesta vacía. Cuándo escribirla lo dice el Goal (PASAR A HUMANO).
