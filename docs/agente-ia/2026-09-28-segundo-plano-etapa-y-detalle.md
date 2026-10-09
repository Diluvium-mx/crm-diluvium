> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Agente IA en segundo plano: etapa y Detalle siempre al día (28-sep-2026)

Decisión del dueño: el Agente IA trabaja **siempre** en segundo plano, aunque esté apagado en el canal o
pausado en el chat, con dos trabajos: (1) mover al contacto a la etapa que corresponde y (2) llenar el
Detalle. Antes solo se llenaba en la misma llamada en la que el agente contestaba; con el agente pausado
(p. ej. porque contestó un vendedor, que es lo normal en la parte de la venta donde salen medidas y montos)
nadie leía el chat. Migración **`0047_lector_detalle`** (siguiente libre: 0048).

- **Qué es:** `lib/ai/runtime/lector.ts` (base de datos) + `lector-core.ts` (puro: instrucciones,
  herramienta `actualizar_contacto`, cómo se le presenta el chat y validación). Modelo fijo **Luna**
  (`gpt-5.6-luna`). Lee TODO el chat en orden en un solo mensaje ("[28 sept 14:03] Cliente: …", con
  Vendedor, Agente IA o Diluvium (automático)), las 6 imágenes/PDF más recientes del cliente
  (comprobantes, fotos con medidas) y al final la ficha guardada. Nunca le escribe al cliente, no deja
  avisos al vendedor y **no dispara** los workflows "al entrar a esta etapa" (`fireStageTriggers: false`).
- **Cuándo lee:** barrido del worker cada minuto (`lector-worker.ts`): chats con
  `last_message_at > detalle_leido_hasta`, de los últimos 3 días, cuando llevan **3 min sin mensajes** o
  el primer mensaje sin leer tiene **15 min**. Máximo 20 por barrido, 3 a la vez. Lee aunque el Agente IA
  haya contestado (la lectura cuesta ~US$0.0005; así monto, pago y etapa siguen una sola regla). Candado
  Redis por chat (`lector-lock:<id>`). Si el modelo falla, no marca leído y reintenta hasta 3 veces por
  mensaje nuevo. La 0047 marcó todo lo anterior como leído.
  **Mismo reloj (7-oct-2026):** «sin leer» se mide con la hora del mensaje (`coalesce(sent_at, created_at)`, la de
  WhatsApp, igual que `last_message_at` y `detalle_leido_hasta`), no con la de llegada (`created_at`, unos segundos
  después). Antes el último mensaje del cliente parecía sin leer para siempre y el chat se leía al instante con
  cualquier mensaje nuevo, sin los 3 min de calma (así una lectura cayó a media respuesta del vendedor). También en
  la revisión «solo hay seguimientos nuevos» (`lector.ts`) y en la espera del Detalle (`lector-status-store.ts`).
- **Reglas del dueño:** lectura LINEAL, vale lo último que confirmó el cliente, aun tras la compra.
  **Monto de cotización** = total de lo que el cliente eligió al final (si se cotizaron 2 y eligió 1, el
  total de 1); si cambió y el precio nuevo nunca se dijo, no se inventa: comentario "falta confirmar el
  total". **Pago total** (`contacts.pago_total`, nuevo) = lo que ya pagó (anticipo + resto o completo).
  **Etapa:** solo hacia adelante; la que puso un vendedor a mano se respeta: el chat lleva la marca
  "[CRM …: un vendedor movió al contacto a «X»…]" en su lugar del tiempo y, si no hay nada después de ese
  cambio, el código descarta cualquier avance. El aviso emergente sale igual que cuando el agente contesta
  ("🤖 Agente IA movió a …").
- **Montos nunca inventados (código):** el monto debe ser una cantidad que dijo la **empresa** en el chat
  o la suma de hasta 4 de ellas (2 × $5,500; compuerta + instalación); el cliente no puede dictarlo. El pago
  debe aparecer en el chat (o ser suma) o el modelo debe haber visto un comprobante (imagen/PDF).
- **Hallazgo con Luna real (28-sep):** Luna manda SIEMPRE todos los campos; sin `null` los rellenaba con
  0, "" o "no_sabe". En producción el agente ya lo hacía: 46 de 50 niveles de agua escritos por el agente
  eran "0 cm" y 40 de 48 "¿inundaciones?" eran "No sabe". Arreglo compartido (agente y lector): cada campo
  acepta `null` = sin dato, 0 cm se descarta (`parseDetalle`) y "no_sabe" nunca reemplaza un sí/no
  (`applyDetalleByAgent`). `fijar_cotizacion` ahora dice "total de lo que el CLIENTE eligió".
- **Gasto:** `ai_usage.stage = 'detalle'`, **sin message_id** (no cuenta como respuesta ni como error del
  agente sobre un mensaje), outcome `detalle_aplicado` / `detalle_sin_cambios` / `error`; en `error` va
  qué cambió y qué se descartó. Medido con Luna real: US$0.0004–0.0012 por lectura (~1,400 tokens de
  entrada, la mitad en caché).
- **Pasada única:** `npm run lector:detalle -- --desde <ISO UTC> [--ensayo]` (`scripts/lector-detalle.ts`).
  El ensayo solo cuenta y estima; la real imprime chats, tokens y costo (el mismo de `ai_usage`).
- **UI:** Detalle › "Monto de cotización (MXN)" y "Pago total (MXN)" lado a lado, los dos con marca "IA"
  y editables por el vendedor (`pagoTotal` en `updateContactQualification`).

### Indicador en el Detalle (29-sep-2026, pedido del dueño)
Una línea bajo "Calificación" (Bandeja y pop-up del Embudo) muestra en vivo qué hace el lector:
**⏳ leerá el chat en ~N min** (hay mensajes sin leer; misma cuenta del barrido: 3 min quieto o 15 min desde el
primero sin leer, más medio paso del barrido), **leyendo el chat…** (orbe), **actualizó N datos** (6 s, mientras
brillan los campos con la marca IA), **✓ Al día · leído 10:42** y **No pudo leer el chat · se reintenta solo**.
- **Sin sondeo ni costo de IA:** el lector avisa `lector.status` (fase `leyendo` antes de llamar a Luna y, en un
  `finally`, `listo` con cuántos datos cambió o `error`) por el mismo NOTIFY `inbox_events` del tiempo real
  (`lib/inbox/lector-status-payload.ts`, `events.ts`, `use-inbox-stream.ts`). Al abrir el contacto hay UNA consulta
  de solo lectura (`lib/actions/agente-lector.ts` → `lib/agente-ia/lector-status-store.ts` → `lector-status.ts`,
  puro): chats del contacto en la organización de la sesión, candado Redis `lector-lock:<id>` (tope 1.5 s; si Redis
  falla, "no está leyendo") y última fila de `ai_usage` etapa `detalle`. Se vuelve a consultar solo con eventos
  (aviso del lector, mensaje de sus chats, reconexión) o al volver a la pestaña.
- **Si un aviso se pierde** (worker reiniciado a media lectura), "leyendo" se apaga solo a los 90 s y la espera
  vuelve a consultar cuando ya debió leerse. Nunca rompe el Detalle: si algo falla, no se muestra nada.
- UI: `app/(app)/contactos/_components/lector-status.tsx`; mapa › Detalle (28).
