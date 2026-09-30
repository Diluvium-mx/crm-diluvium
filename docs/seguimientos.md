# Seguimientos por contexto — diseño

> **Estado (30-sep-2026): el dueño aprobó la ESTRUCTURA (el orden de los 7 pasos, §4). Nada construido.**
> Quedan abiertas las decisiones de la §12 (tienen propuesta de fábrica). Se construye por partes (§11), cada
> una por staging y con "OK MAIN". Este documento **reemplaza** al del 25-sep-2026, que disparaba el seguimiento
> por tiempo ("2 días sin respuesta") y después veía qué decir: el orden correcto es al revés.
> Fuentes al final: **[M#]** Meta, **[Z#]** Zernio, **[G#]** GoHighLevel/GoGHL, **[C#]** código del CRM.

---

## 1. En corto

Cuando un chat se queda parado (el último mensaje es nuestro y el cliente ya no contesta), el Agente IA
**primero entiende qué quedó pendiente** (cotización sin respuesta, faltan medidas, pago sin comprobante, "escríbeme
el lunes"…), **después decide cuándo y qué decirle** para que avance un paso hacia comprar, y **al final** sale por
la puerta que toque:

- **Ventana de 24 h abierta:** el Agente IA le escribe un mensaje personal (texto libre).
- **Ventana cerrada:** sale una **plantilla-puerta** (`hola_buenos_dias` / `hola_buenas_tardes`, según la hora del
  cliente). Cuando el cliente contesta se abre la ventana y el Agente IA retoma **con el mismo contexto**: le dice lo
  que quedó pendiente.
- **Chats que ya tomó un vendedor:** no se manda nada solo. La ficha y el mensaje sugerido le quedan al vendedor
  para mandarlo con un clic (desde el CRM o gratis desde WhatsApp Web).

La lectura del chat la hace el **lector en segundo plano** que ya existe (Luna lee cada chat completo 3 min después
del último mensaje para llenar el Detalle y la etapa [C1]): la ficha de seguimiento sale en esa **misma lectura**,
sin una llamada extra.

---

## 2. Qué hacía GoHighLevel y por qué no se copia tal cual

- En GHL **todo** el seguimiento lo hacía la IA de Ángela (Conversation AI), no los workflows [G1]:
  "Dejó de responder" 2 días · 1 intento (activo), "Solicitud de contacto" 2 h (activo), "Ocupado" 2 h (apagado).
  Horario 8:00–18:00 hora del contacto, redactado por la IA.
- GHL **no tenía el WhatsApp oficial**: los mensajes salían por **GoGHL**, un programa que se conecta como un
  WhatsApp Web más (dispositivo vinculado por QR) y por eso no tenía ventana de 24 h ni plantillas [G2]. WhatsApp
  prohíbe ese tipo de conexión y puede bloquear el número [M9][M10]. Hoy el mismo número sostiene el CRM, el Agente IA,
  Zernio y los anuncios: **no se conecta un programa así** (decisión informada al dueño el 28-sep).
- Con WhatsApp **oficial**, ni GHL manda el seguimiento de Ángela por WhatsApp después de 24 h: lo pasa a SMS [G3].
- De GHL oficial **sí se copia** [G4]: revisar la ventana antes de cada envío automático (rama abierta/cerrada),
  plantilla aprobada de antemano para la rama cerrada, variables llenadas con datos del contacto, cancelar si el cliente
  contesta, horario laboral y tope de intentos.

---

## 3. Reglas de WhatsApp que mandan

| Regla | Qué significa aquí |
|---|---|
| Ventana de 24 h [M1] | Se abre con **cada mensaje del cliente**. Dentro: texto libre. Fuera: **solo plantilla aprobada**. Mandar una plantilla **no** abre la ventana: la abre la respuesta del cliente. |
| Precio desde el 1-oct-2026 [M2] | Texto libre del Agente IA o del CRM = mensaje de **servicio**: ~MX$0.16, con **1,000 gratis al mes** por número (compartidos con todas las respuestas del Agente IA). Plantilla de **marketing** (un seguimiento de venta) ~MX$0.73. |
| Anuncios [M3] | Si el cliente llegó por un anuncio y se le contestó en 24 h, lo que se le mande **no cuesta** por un tiempo (72 h; Meta anunció hasta 7 días el 28-sep). Es **precio**, no permiso: fuera de 24 h sigue siendo solo plantilla. |
| App y WhatsApp Web (coexistencia) [M4] | Lo que escribe **una persona** desde la app del celular o WhatsApp Web es gratis y no tiene ventana. |
| Tope de marketing por persona [M5] | Si el cliente ya recibió muchas plantillas de marketing (de todas las empresas), Meta no la entrega: error **131049**. **Nunca** se reintenta solo. |
| Bajas [M6] | Si el cliente se da de baja del marketing: error **131050**. El contacto queda "sin seguimientos". |
| Calidad [M7] | Bloqueos y reportes bajan la calidad del número y Meta pausa la plantilla (3 h, 6 h, desactivada). Por eso hay topes (§9). |

Las 3 plantillas de Diluvium están **aprobadas** (verificado en vivo el 30-sep): `hola_buenos_dias`,
`hola_buenas_tardes`, `seguimiento_proteccion` (Marketing, es_MX).

---

## 4. El orden correcto (7 pasos)

1. **Detectar que el chat se quedó parado.** El último mensaje es **nuestro** (Agente IA, vendedor o workflow) y el
   cliente no contesta. Si el último es del cliente, no hay seguimiento: toca contestarle.
2. **Revisar el chat completo y llenar la ficha de seguimiento** (§5). La llena el lector en la misma lectura que
   ya hace para el Detalle. La ficha dice qué quedó pendiente, qué puntos están claros, qué falta para que sea cliente
   potencial, si vale la pena, cuándo y un borrador del mensaje.
3. **Decidir cuándo según el caso** (§6): cada caso tiene su momento y su objetivo. Si el cliente pidió una fecha,
   manda esa fecha. Todo cae dentro del horario (8:00–18:00 hora del cliente). Un chat tiene como máximo **un**
   seguimiento pendiente; una ficha nueva reemplaza a la anterior.
4. **Al llegar la hora, volver a revisar y salir por la puerta que toque** (§7). Si el cliente escribió, un vendedor
   contestó o el contacto ya compró, se cancela. Si sigue en pie, el Agente IA actualiza el mensaje con lo más
   reciente y sale: ventana abierta → texto; cerrada → plantilla-puerta.
5. **Si contesta:** el Agente IA sigue sabiendo por qué le escribió ("te escribí por tu cotización") y empuja el
   siguiente paso de la ficha. La etapa y el Detalle los sigue moviendo el lector.
6. **Si no contesta:** un **segundo intento** con otro enfoque (§6). Después se detiene: la temperatura pasa a
   **frío** y queda un aviso 🤖 para el vendedor.
7. **Visible y medible:** en el chat se ve el seguimiento programado con su motivo (Ver mensaje · Cambiar hora ·
   Cancelar); en Agente IA › Seguimientos se editan los casos; en el Dashboard, cuántos contestaron y cuántos
   avanzaron de etapa.

---

## 5. La ficha de seguimiento

La devuelve el lector, en la misma herramienta `actualizar_contacto`, **solo cuando el último mensaje es nuestro**:

| Campo | Qué es | Ejemplo |
|---|---|---|
| `caso` | Qué quedó pendiente (uno de la §6) | `cotizacion_sin_respuesta` |
| `pendiente` | En una línea, lo que quedó abierto | "Se le cotizaron 2 compuertas de 90 cm ($8,400) y no respondió" |
| `siguiente_paso` | Lo que lo acerca a comprar | "Resolver dudas y ofrecer apartar el precio" |
| `vale_la_pena` + `motivo` | No, si dijo que no, ya compró, está fuera de zona o pidió que no le escriban | `false` · "Dijo que ya lo compró en otro lado" |
| `fecha_pedida` | Si el cliente pidió que le escribieran en una fecha u hora ("el lunes", "en la tarde") | "2026-10-05T10:00" (hora de Mazatlán) |
| `borrador` | El mensaje personal, corto (máx. 2 líneas), como lo diría el Agente IA | "Hola Ana, ¿pudiste revisar la cotización de tus 2 compuertas? Si quieres te aparto el precio de esta semana 😊" |

**Puntos claros** (✓/✗) **no los inventa el modelo**: salen del Detalle guardado — problema de inundación, número
de entradas, medidas, nivel de agua, cotización enviada, pago. Sirven para dos cosas:
- el `siguiente_paso` apunta al **primer punto que falta** (o a cerrar la venta si todo está claro);
- los chats **con todos los puntos claros** van primero (son los más cerca de comprar).

---

## 6. Casos, tiempos y objetivos (propuesta de fábrica; se editan en Agente IA › Seguimientos)

| Caso (`caso`) | 1.er intento | 2.º intento | Qué busca el mensaje |
|---|---|---|---|
| **Pidió que le escribieran** (`pidio_fecha`) | La fecha/hora que pidió | +1 día | Retomar como quedaron |
| **Dijo que estaba ocupado** (`ocupado`) | 2 h | +1 día | Retomar |
| **Pidió un asesor y nadie contestó** (`pidio_asesor`) | 30 min: **aviso al vendedor** (no al cliente) · 2 h: mensaje de disculpa | — | Que lo atienda un vendedor |
| **Pago pendiente** (datos bancarios, sin comprobante) (`pago_pendiente`) | Antes de que cierre la ventana (~22 h) | +1 día (puerta) | El comprobante o resolver dudas de pago |
| **Cotización sin respuesta** (`cotizacion_sin_respuesta`) | ~22 h | +1 día (puerta) | Resolver dudas y cerrar |
| **Faltan datos para cotizar** (`faltan_datos`) | ~22 h | +1 día (puerta) | Pedir exactamente el dato que falta |
| **"Lo voy a pensar" u objeción** (`objecion`) | 1 día | +2 días | Responder esa objeción |
| **Dejó de contestar sin nada claro** (`sin_punto_claro`) | 2 días (como Ángela) | — | Reenganchar |
| **No seguir** (`no_seguir`) | Nunca | — | — |

- "**~22 h**" = antes de que cierre la ventana de 24 h, dentro del horario (si a esa hora es de noche, se adelanta a
  la última hora del horario que quede antes del cierre). Así el 1.er intento sale como **texto personal** (barato y
  sin plantilla) y solo el 2.º necesita la puerta.
- Los tiempos se cuentan desde el **último mensaje nuestro**.
- Si el cliente contesta en medio, el seguimiento se cancela y la siguiente lectura hace una ficha nueva.

---

## 7. Por dónde sale

**Ventana abierta:** el Agente IA (el modelo de la etapa del contacto, con el Goal, las FAQs y el chat completo)
recibe la ficha y escribe **un** mensaje. Sale como del Agente IA (`source: ai_agent`): no pausa al Agente IA, no
marca leído y no cuenta como primera respuesta humana.

**Ventana cerrada (plantilla-puerta):**
1. Sale `hola_buenos_dias` antes de las 12:00 hora del cliente, `hola_buenas_tardes` después. En el 2.º intento,
   `seguimiento_proteccion` (otra redacción, para no repetir el mismo saludo).
2. El seguimiento queda "esperando respuesta" con su ficha.
3. Cuando el cliente contesta, la respuesta normal del Agente IA lleva en su contexto
   *"Seguimiento: le escribimos por «pendiente»; objetivo: «siguiente paso»"*, así que retoma justo ese punto.
4. Si llegó por anuncio y sigue en su ventana gratis, la plantilla no cuesta.

**Chats que tomó un vendedor** (Agente IA en pausa en ese chat): **no sale nada solo**. En el chat queda
"🤖 Seguimiento sugerido · Cotización sin respuesta" con el borrador y tres botones: **Mandar** (desde el CRM, si la
ventana está abierta; si no, con la plantilla-puerta), **Abrir en WhatsApp Web** (gratis, texto ya escrito) y
**Descartar**.

---

## 8. Qué se ve en el CRM

- **En el chat** (Bandeja y pop-up del Embudo), abajo, como los programados de hoy:
  `🤖 Seguimiento · mié 10:00 · Cotización sin respuesta — Resolver dudas y cerrar   [Ver mensaje] [Cambiar hora] [Cancelar]`.
  Cuando sale, la burbuja se vuelve el mensaje real. Lo que se cancela solo no se muestra (menos datos), salvo que
  deje aviso.
- **Agente IA › Seguimientos:** la tabla de la §6 (encender/apagar cada caso, tiempos del 1.er y 2.º intento,
  objetivo en texto), el horario y la hora del cliente.
- **Dashboard:** una tarjeta: seguimientos enviados · contestaron · avanzaron de etapa (del periodo elegido).
- **Historial:** los cambios a la tabla de casos quedan en Agente IA › Historial.

---

## 9. Topes y paradas (fijos en el código)

- Se cancela si: el cliente escribe, un vendedor escribe, el contacto llega a la etapa con papel **Venta cerrada**,
  el Agente IA está apagado en el canal, el caso se apagó, o un vendedor lo cancela.
- Máximo **2 intentos** por punto pendiente. Después: temperatura **frío** + aviso 🤖 "No contestó 2 seguimientos".
- Máximo **1 plantilla de seguimiento por contacto cada 7 días**.
- **131049** (tope de marketing): aviso, sin reintento. **131050** (baja): el contacto queda "sin seguimientos"
  (se quita desde el Detalle).
- Solo a contactos que **ya escribieron** alguna vez (nunca a un contacto sin chat).
- Horario de envío: 8:00–18:00 **hora del cliente** (estado de su lada → zona horaria; sin lada mexicana, Mazatlán).

---

## 10. Costo estimado (supuestos a la vista)

Base: ~4,000 contactos al mes atendidos por el Agente IA (GHL, jul–sep-2026 [G1]). Supuesto: **la mitad** se queda
parada con algo pendiente (~2,000 al mes) y **la mitad** de esos no contesta el 1.er intento (~1,000).

| Concepto | Cuenta | Al mes |
|---|---|---|
| Ficha de seguimiento | Sale en la lectura que ya existe (unos tokens más de Luna) | ≈ US$0.5 |
| 1.er intento con texto (~2,000) | Servicio ~MX$0.16 (los 1,000 gratis ya los usan las respuestas normales) + redacción de la IA | ≈ MX$320 + US$10–60 |
| 2.º intento con plantilla-puerta (~1,000) | Marketing ~MX$0.73 (gratis si sigue en la ventana del anuncio) | ≈ MX$730 o menos |

Total aproximado: **MX$1,100–2,100 al mes**. Se ajusta con los números reales después de una semana.

---

## 11. Plan de construcción (por partes; cada una por staging y "OK MAIN")

| Parte | Qué | Migración |
|---|---|---|
| **0** | Plantillas al día solas (se sincronizan al abrir Plantillas y el 📄, y el worker revisa cada 15 min mientras haya alguna "En revisión"); `{{1}}` se llena solo con el nombre del contacto. | No |
| **1** | Tabla `follow_ups` + la ficha en el lector + cálculo de la hora (§6, horario por lada) + la burbuja en el chat. **Modo ensayo: no manda nada**, para que el dueño vea en chats reales si las fichas y los tiempos tienen sentido. | 0052 |
| **2** | Envío con la ventana abierta (el Agente IA redacta con la ficha) + paradas + 2.º intento + frío y aviso. | Quizá |
| **3** | Ventana cerrada: plantilla-puerta como del Agente IA (sin pausarlo), retomar con contexto cuando conteste, topes de 7 días, 131049/131050. | No |
| **4** | Agente IA › Seguimientos (editar la tabla), chats de vendedor (sugerido + WhatsApp Web), tarjeta del Dashboard, mapa y capturas. | No |

Pruebas: lógica pura (casos, horas, zona por lada, topes) con Vitest; integración con Postgres real (ficha → programa
→ cancela/sale); staging con webhooks firmados. La prueba real del envío solo se puede hacer en producción, con un
contacto de prueba del dueño.

---

## 12. Decisiones para el dueño (con propuesta de fábrica)

1. **Chats que tomó un vendedor:** ¿solo sugerencia para el vendedor (propuesta) o también automático?
2. **Tabla de casos (§6):** ¿algún caso, tiempo u objetivo que cambiar?
3. **Horario:** 8:00–18:00 hora del cliente, todos los días, como Ángela (propuesta).
4. **Intentos:** máximo 2 y luego frío + aviso (propuesta).
5. **Puerta:** saludo según la hora en el 1.er uso y `seguimiento_proteccion` en el 2.º (propuesta).

---

## 13. Detalle técnico (para Code)

**Datos (migración 0052):** `follow_ups` — id, organization_id, conversation_id, contact_id, caso, pendiente,
siguiente_paso, borrador, fecha_pedida, intento (1|2), due_at, status
(`programado` | `enviando` | `esperando_respuesta` | `enviado` | `contestado` | `cancelado` | `sugerido` | `fallido`),
cancel_reason, door (`texto` | `plantilla`), template_id, message_id, based_on_message_at (el último mensaje que leyó
el lector), created_at, updated_at. Índice único parcial: un solo `programado`/`esperando_respuesta` por conversación.
Tabla de casos editable: `follow_up_rules` (caso, encendido, espera_1, espera_2, objetivo) o `ai_config.jsonb`.
`contacts.sin_seguimientos` (bool) para las bajas.

**Código:**
- `lib/ai/runtime/lector-core.ts`: el esquema de `actualizar_contacto` (`lectorSchemaFor`) suma `seguimiento`
  (opcional), y las instrucciones del lector explican los casos. Validación pura nueva (caso válido, textos acotados,
  fecha futura < 60 días).
- `lib/ai/runtime/lector.ts`: al aplicar la lectura, si el último mensaje es nuestro, guarda o reemplaza la ficha y
  calcula `due_at` (`lib/followups/rules.ts`, puro).
- `lib/followups/timezone.ts` (puro): estado de la lada (`lib/phone-lada-data.ts`) → zona horaria (Tijuana, Hermosillo,
  Mazatlán, Chihuahua/Ciudad Juárez, CDMX, Cancún).
- Worker: `startFollowUpRuntime` con el patrón de `startLectorRuntime` (barrido cada 60 s, candado por chat).
- `lib/messaging/send.ts`: `sendTemplateMessage` acepta `source` (`crm` | `ai_agent`) y `sentByUserId` nulo; con
  `ai_agent` no pasa por `pauseAgentForManualSend`.
- `lib/ai/runtime/actions.ts` (`crmContextFor`): agrega la línea del seguimiento esperando respuesta.
- `lib/ai/runtime/policy.ts` (`NoticeKind`): tipo nuevo `seguimiento`.
- UI: burbuja en `chat-thread.tsx` junto a `ScheduledInThread`; subpestaña en Agente IA; tarjeta del Dashboard.

---

## Fuentes

- [M1] Meta, enviar mensajes / ventana de servicio: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
- [M2] Meta, precios (1-oct-2026; 1,000 gratis al mes): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- [M3] Meta, registro de cambios (ventana gratis de anuncios hasta 7 días, 28-sep-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- [M4] Meta, coexistencia: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
- [M5] Meta, tope de marketing por persona: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits
- [M6] Meta, códigos de error: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
- [M7] Meta, pausa de plantillas: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pausing/
- [M9] WhatsApp, apps no oficiales: https://faq.whatsapp.com/1217634902127718
- [M10] Términos de la app WhatsApp Business (23-sep-2026), cláusula (g): https://www.whatsapp.com/legal/WhatsApp-Terms-for-WhatsApp-Business-App
- [G1] Ask AI de GHL sobre la cuenta de Diluvium (28-sep-2026): seguimientos de Ángela, sin WhatsApp oficial, volumen jul–sep.
- [G2] GoGHL: https://goghl.ai/es y https://help.goghl.ai/whatsapp/full-setup
- [G3] GHL, seguimiento automático de Conversation AI (en WhatsApp pasa a SMS tras 24 h): https://help.gohighlevel.com/support/solutions/articles/155000005500-conversation-ai-auto-follow-up-action
- [G4] GHL, revisión de ventana en workflows: https://help.gohighlevel.com/support/solutions/articles/155000003235-whatsapp-customer-service-window-check · acción WhatsApp: https://help.gohighlevel.com/support/solutions/articles/155000003531-workflow-action-whatsapp
- [C1] Lector en segundo plano: `lib/ai/runtime/lector-core.ts`, `lector.ts`, `lector-worker.ts` (main 8426d80).
- Investigación previa (plantillas, edición, coexistencia): `docs/investigacion/plantillas-zernio.md`.
