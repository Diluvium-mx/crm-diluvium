# Seguimientos del Agente IA — diseño

> **Estado: SOLO DISEÑO (25-sep-2026). No hay código.** Nada de esto se construye hasta que el dueño
> apruebe el documento y conteste las decisiones de la §10. Rama `docs/seguimientos-diseno`.
> Fuentes numeradas al final: **[M#]** = Meta, **[Z#]** = Zernio, **[C#]** = código o docs del CRM.

---

## 1. Resumen en lenguaje simple

**Qué es.** Una sección nueva, **"Seguimientos"**, dentro de la pestaña Agente IA. Ahí se crean,
editan, encienden/apagan y borran reglas del tipo "si el cliente deja de contestar 2 días, escríbele".
Además, el bot aprende a **apartar un seguimiento cuando el cliente se lo pide** ("escríbeme el
lunes"). El vendedor ve en el chat cada seguimiento apartado ("🤖 Seguimiento: lunes 10:00") y lo
puede cancelar con un clic. Vendedores y admin pueden editar la sección.

**Qué hacía Ángela en GHL.** Solo corrían 3 seguimientos: "dejó de responder" (2 días), "solicitud
de contacto" (2 horas) y "ocupado" (apagado). Los redactaba la IA y salían de 8:00 a 18:00. Los
workflows de seguimiento de GHL nunca corrieron (estaban en borrador).

**El cambio grande: WhatsApp oficial pone reglas que GHL se saltaba.** GHL mandaba mensajes por una
conexión no oficial, así que Ángela podía escribir a los 2 días como si nada. Con el número oficial
(Zernio) aplica la regla de Meta:
- **Hasta 24 horas** después del último mensaje del cliente, el bot puede escribir lo que quiera.
- **Pasadas las 24 horas**, solo se puede mandar una **plantilla** (un mensaje fijo que Meta aprobó
  antes, con el nombre del cliente como variable). Un "¿sigues interesado?" es plantilla de
  **marketing**, la más cara.
- **Si el cliente llegó por un anuncio** y se le contestó dentro de 24 h, durante **72 horas** todo lo
  que se le mande es **gratis**, plantillas incluidas.

**Aviso importante de Meta (en 6 días).** Desde el **1 de octubre de 2026** Meta **empieza a cobrar
también los mensajes normales** (los que el bot o un vendedor mandan dentro de las 24 h), a
**$0.16 pesos** cada uno después de los primeros 1,000 del mes, y la plantilla de marketing en
México **sube a $0.73 pesos**. Los mensajes que un vendedor manda **desde la app del celular** siguen
gratis. Los que caen dentro de las 72 h de un anuncio, también.

**La propuesta, en corto.**
1. Los 3 seguimientos de Ángela vienen puestos de fábrica, con sus mismos tiempos.
2. Si el seguimiento cae **dentro de la ventana**, lo redacta la IA (como Ángela).
3. Si cae **fuera**, sale una **plantilla aprobada**; si todavía no hay plantilla, **no se manda nada
   y se avisa al vendedor** en el chat.
4. Opción **"adelantar"**: mover el seguimiento para que salga antes de que se cierre la ventana
   (más barato y sin plantilla).
5. El bot aparta seguimientos cuando el cliente se lo pide, y los cancela si el cliente ya no quiere.
6. Todo seguimiento se cancela solo si el cliente contesta, si un vendedor toma el chat, si el bot
   está apagado o si el contacto llegó a **Compra**. (Lo que el cliente pidió no se borra con un "ok,
   gracias": ahí decide el bot.)

**Costo.** Los seguimientos cuestan poco: alrededor de **$36 pesos al mes por cada 100 leads nuevos**
(unos $145 al mes si son 400 leads al mes; unos $4,350 si fueran 400 al día). El detalle y los
supuestos están en la §8.

**Pruebas.** Todo lo que pasa **dentro de las 24 h** se prueba ya con el número de prueba N2. Las
**plantillas** solo se pueden probar el día del número oficial.

---

## 2. Reglas de Meta y de Zernio que mandan

### 2.1 Ventana de servicio de 24 h

- Se abre con **cada mensaje del cliente** y dura 24 h. Dentro de ella se puede mandar texto libre,
  fotos, videos y cualquier plantilla [M1][M2]. Fuera de ella, un texto libre falla con el error
  **131047** ("More than 24 hours have passed…") [M14][Z9].
- **Cobro por mensaje** desde el 1-jul-2025 [M1]: Meta cobra cada mensaje **entregado**, según su
  categoría y el país del cliente.
- **Hasta el 30-sep-2026** el texto libre dentro de la ventana es gratis (desde nov-2024), y también
  las plantillas de utilidad dentro de la ventana (desde jul-2025) [M1].
- **Desde el 1-oct-2026** Meta cobra también los **mensajes de servicio** (texto libre del bot o de un
  vendedor por API): *"Effective October 1, 2026, Meta will charge for service messages"* [M2]. La
  tarifa es la misma que la de utilidad en cada país [M2]. Las plantillas de utilidad dentro de la
  ventana dejan de ser gratis ese mismo día [M2].
  - Según la página de precios, cada número tiene **1,000 mensajes de servicio gratis al mes**, que no
    se acumulan [M1]. *La versión de la página que bajé con otra herramienta no mostraba ese
    párrafo: hay que confirmarlo antes de construir.*
  - Un texto libre con tono de venta dentro de la ventana se cobra solo como servicio, no como
    marketing [M2].
- **Coexistencia (nuestro caso):** lo que un vendedor manda **desde la app WhatsApp Business del
  celular** sigue gratis y **no está sujeto a la ventana de 24 h** [M15]. Lo que sale por la API (el
  bot o la Bandeja del CRM) paga la tarifa de la API.
- **Método de pago:** Zernio avisa que, sin un método de pago en la WABA, Meta deja de entregar
  plantillas al agotarse lo gratis [Z15]. Meta dice lo mismo de los mensajes de servicio desde el
  1-oct [M1][M2]. **Hay que confirmar que la WABA "Grupo Diluvium" tiene método de pago antes del
  número oficial.**

### 2.2 Ventana gratis de 72 h (anuncios)

- Aplica cuando el cliente escribe desde un **anuncio de clic a WhatsApp** o desde el **botón de una
  Página de Facebook**, en celular (no escritorio ni web), y el negocio le **contesta dentro de 24 h**.
  Esa respuesta abre la ventana [M1].
- *"FEP windows remain open for 72 hours. While open, you can send any type of message to the user
  at no charge"* [M1]. Esto **incluye plantillas de marketing**. **Sigue igual después del 1-oct-2026**
  [M2].
- **Ojo:** las 72 h son de **precio**, no de permiso. Si la ventana de 24 h ya se cerró, solo se
  pueden mandar plantillas, aunque salgan gratis [M1].
- **Cómo se reconoce:** el primer mensaje trae el objeto `referral` del anuncio [M4]; el webhook de
  estado marca `pricing.type: "free_entry_point"` [M3].
- **En el CRM:** Anuncios de Meta entró a `main` el 26-sep (abce8e6). Ya guarda
  `conversations.ad_entry_at` (última entrada por anuncio) y calcula la ventana en
  `lib/ads/free-window.ts` [C1]. Los seguimientos la reusan tal cual.

### 2.3 Fuera de la ventana: solo plantilla aprobada

- Política de Meta: *"you may only send messages via approved Message Templates"* fuera de las 24 h
  [M10]. Una plantilla lleva variables `{{1}}`, `{{2}}` y Meta la revisa antes de aprobarla.
- Una plantilla aprobada **no se edita**: un cambio es una plantilla nueva que vuelve a revisión [C2].
- **Mandar una plantilla no reabre la ventana.** La ventana solo la abre un mensaje del cliente [C2].
- **Errores de envío:**
  - **132001**: la plantilla no existe (nombre o idioma mal).
  - **132015**: plantilla pausada.
  - **132016**: plantilla deshabilitada.
  - **131026**: mensaje no entregable.
  - Todos se guardan en `messages.error_code` y se muestran en el chat [M14][Z14], como manda
    CLAUDE.md §7.

### 2.4 Categorías: un "¿sigues interesado?" es MARKETING

- **Utilidad:** avisos no promocionales, específicos de un pedido o una cuenta del cliente, o que
  "follow up on user actions or requests" [M5]. Si el mensaje mezcla utilidad y promoción, cuenta
  como marketing [M5].
- **"Hola {{1}}, ¿sigues interesado en tu compuerta? ¿Te ayudo con algo?" es marketing.** Meta pone
  como marketing el "retargeting" a quien ya "engaged with you" y el "prompting new conversations"
  [M5].
- **Meta recategoriza.** Desde el 9-abr-2025, una plantilla enviada como UTILITY que Meta considere
  MARKETING **se aprueba como marketing** en vez de rechazarse. Además, Meta revisa periódicamente
  las ya aprobadas y avisa con 24 h (webhook y correo). Hay 60 días para apelar [M5]. Zernio avisa
  de estos cambios con `whatsapp.template.category_updated` [Z6].
- **Abusar de "utilidad" tiene castigo** (según la misma página): advertencia, luego límite de envíos, luego sin utilidad por
  7 o 30 días y al final restricción del portafolio [M5]. **Recomendación:** mandar a revisión los
  seguimientos de venta como **MARKETING** desde el inicio. Solo el recordatorio de pago (§7) se
  intenta como utilidad.

### 2.5 Límites, bajas y calidad del número

- **Tope de marketing por persona:** WhatsApp limita cuántas plantillas de marketing recibe cada
  persona, sumando las de todas las empresas. Depende de cuánto lee esa persona [M6].
  - Si se pasa, el error es **131049** y hay que esperar **al menos 24 h** antes de reintentar.
    Reintentar seguido bloquea más tiempo [M6].
  - Las plantillas de marketing que salen **dentro** de una ventana abierta no cuentan para el tope
    [M6].
  - **El CRM nunca reintenta solo un 131049:** avisa al vendedor.
- **Límite de mensajería:** cuántos números distintos se contactan fuera de ventana en 24 h, a nivel
  **portafolio**. Escalones: 250, 2,000, 10,000, 100,000 y sin límite [M7][M8]. Zernio dice que un
  número nuevo arranca en 250 [Z13][Z17]. Con 400 leads al día, "dejó de responder" podría rozar el
  escalón de 250 los primeros días; sube solo si la calidad es buena [M7].
- **Permiso (opt-in):** Meta exige permiso antes de escribirle a alguien. El permiso puede ser
  general y tiene que decir el nombre de la empresa. Hay que respetar las bajas "on or off WhatsApp"
  [M9][M10].
  - El cliente puede **dejar de recibir marketing**: Meta avisa con el webhook `user_preferences`
    [M11], y mandarle después da el error **131050**, que no se reintenta [M14].
  - **El CRM marca a ese contacto "sin seguimientos"** (decisión 8).
- **Calidad del número:** se mide sobre los últimos 7 días, con bloqueos y reportes (verde, amarillo
  o rojo) [M12].
  - Una plantilla con mala calidad se **pausa 3 h**, luego **6 h** y a la tercera **se deshabilita**
    [M13].
  - Si se repite, "the phone number may eventually be impacted" [M13].
  - Por eso hay **topes** en la §6.4.

### 2.6 Precios en México

Cobro por mensaje **entregado**. Las tarifas salen de los archivos oficiales de Meta enlazados desde
[M1] (los archivos son enlaces que caducan; la página es la referencia). Tipo de cambio implícito de
Meta: ~18.4 pesos por dólar.

| Categoría | Hasta el 30-sep-2026 | **Desde el 1-oct-2026** |
|---|---|---|
| Marketing | US$0.0305 (MX$0.56) | **US$0.0397 (MX$0.73)**, sube 30 % |
| Utilidad | US$0.0085 (MX$0.16); gratis dentro de la ventana | US$0.0085 (MX$0.16), también dentro de la ventana |
| Servicio (texto libre del bot o del CRM) | gratis | **US$0.0085 (MX$0.16)**, después de 1,000 gratis al mes por número |
| Cualquier mensaje dentro de las 72 h de un anuncio | gratis | gratis |
| Mensaje desde la app del celular (coexistencia) | gratis | gratis |

- Meta solo cambia tarifas el primer día de cada trimestre [M1].
- **Zernio** no cobra encima de Meta: *"never marks up or re-bills Meta's fees"* [Z15]. Meta cobra
  directo al método de pago de la WABA.
- Zernio cobra aparte, desde el 1-oct-2026, **US$0.0001 por mensaje saliente** después de 10,000
  gratis al mes [Z18]. Es despreciable (US$1 por cada 10,000 mensajes extra).
- Las 1–2 primeras cuentas conectadas en Zernio son gratis [Z18].

### 2.7 Plantillas por la API de Zernio

- **Crear:** `POST /v1/whatsapp/templates` con `accountId`, `name` (minúsculas y `_`), `category`,
  `language` (`es_MX`) y `components`. El texto BODY lleva `{{1}}` y un ejemplo obligatorio en
  `example.body_text`.
  - **Se manda sola a revisión de Meta** y queda `PENDING`. La revisión puede tardar hasta 24 h
    [Z1][Z2].
  - El CRM ya tiene el alta hecha (`lib/messaging/zernio.ts`, solo owner/admin) [C3].
- **Estado:**
  - Consulta: `GET /v1/whatsapp/templates?accountId=…` (lee en vivo de Meta) y
    `GET /v1/whatsapp/templates/{name}?accountId=…&language=` [Z3][Z4].
  - Estados posibles: `PENDING`, `APPROVED`, `REJECTED`, `IN_APPEAL`, `PAUSED`, `DISABLED` y
    `PENDING_DELETION`. **Solo `APPROVED` se puede mandar** [Z2].
  - Webhooks: `whatsapp.template.status_updated` y `whatsapp.template.category_updated` [Z6].
  - Hoy el CRM **no escucha** estos webhooks; el estado se refresca con el botón "Sincronizar" [C3].
- **Enviar con `{{1}}` = nombre:**
  - En una conversación que ya existe: `POST /v1/inbox/conversations/{id}/messages` con
    `template.elements[].components[{type:"body", parameters:[{type:"text", text:"Juan"}]}]` [Z8].
    Esto ya existe en el CRM (`sendTemplateMessage`) [C3].
  - Para empezar una conversación nueva existe `POST /v1/inbox/conversations` con `templateName` y
    `templateParams` [Z7]. No hace falta para seguimientos.
- **¿Se pueden crear antes de conectar el número oficial? Por la API de Zernio, no.**
  - `accountId` es obligatorio y tiene que ser una cuenta de WhatsApp **ya conectada**; si no, da
    404 [Z1][Z2].
  - Las plantillas son **de la WABA, no del número** [Z3]. Por eso hay otra ruta: **crearlas a mano en
    WhatsApp Manager de Meta**, en la WABA "Grupo Diluvium". Zernio las lee en vivo de Meta, así que
    deberían aparecer al conectar el número [Z3]. *Es una inferencia de las docs, no está escrito
    tal cual: se confirma al conectar.*
  - N2 vive en **otra** WABA ("Diluvium Pruebas") sin método de pago, así que ahí no se pueden
    probar plantillas [C4].
- *No verificado:* Zernio documenta un "Meta Direct Send" (texto de utilidad sin plantilla, solo para
  WABAs elegibles) [Z7][Z8]. No aparece en las docs de Meta que se revisaron. **Este diseño no lo usa.**

---

## 3. Qué ya existe en el CRM y qué se reúsa

| Pieza | Dónde | Qué se reúsa | Qué NO sirve tal cual |
|---|---|---|---|
| **Mensajes programados** (🕒 Programar) | `lib/scheduled/*`, `worker/scheduled.ts`, tabla `scheduled_messages` | El patrón completo: cola BullMQ con retraso más barrido de 60 s, reclamo atómico, "cancelar si el cliente escribe", reconciliar envíos atorados, hora de Mazatlán (`SCHEDULE_TIME_ZONE`), la burbuja punteada en el chat (`ScheduledInThread`) | Todo programado es **de un vendedor**: el autor es obligatorio y **al salir pausa al bot** (`pauseAgentForManualSend`). Un seguimiento del bot no debe pausarlo. Por eso va en su propia tabla |
| **Plantillas 📄** | `lib/templates`, tabla `templates`, `sendTemplateMessage`, selector del composer | Sincronizar, "enviable" = `APPROVED` y no `unsupported`, variables `{{1}}` posicionales, envío idempotente | `sendTemplateMessage` fija `source:"crm"` y exige un usuario. Hay que permitir `source:"ai_agent"` sin usuario |
| **Ventana 24 h** | `conversations.window_expires_at` (solo la mueve un entrante), `isWindowOpen` | Tal cual | — |
| **Ventana 72 h** | `lib/ads/free-window.ts` + `conversations.ad_entry_at` (Anuncios, en `main` desde abce8e6) | Tal cual: decide si una plantilla sale gratis | — |
| **Acciones internas del agente** | `lib/ai/runtime/tools.ts` (`mover_etapa`, `aviso_vendedor`, `fijar_cotizacion`), ejecutadas en `actions.ts` | Mismo mecanismo: herramienta sin `execute`, en la misma llamada, sin costo extra | — |
| **Contexto del CRM** para el agente | `crmContextFor` (`actions.ts`), al final del último turno del cliente | Se le agregan la fecha y hora y el seguimiento pendiente | — |
| **Apagar bot** | `agent_state`, `agent_paused_until`, `BotOffMenu` | "Bot apagado" = no sale ningún seguimiento del bot | — |
| **Avisos 🤖** | `ai_agent_notices` (`kind` es texto libre), `AgentNoticeLine` | Un tipo nuevo `seguimiento` para "no se mandó porque…" | — |
| **Etapas** | `contacts.stage` (`inbox → prospecto → interesado → cerca_compra → compra`), `stage_changed_by` | Filtro por etapa y "Compra cancela" | — |
| **Lada → lugar** | `lib/phone-lada.ts` (estado por lada) | Hora del contacto: el estado se traduce a zona horaria | La lada es donde se contrató la línea, no donde vive el cliente |
| **Modelo por etapa** | `ai_config.modelo_1` / `etapas_modelo_1` | La IA que redacta el seguimiento es la misma que atiende esa etapa | — |
| **Barridos** | `worker/index.ts` (cada 60 s) | Un barrido más, igual al de programados | — |

Datos de partida verificados en el código (`main` ebcd981, más Anuncios abce8e6) [C5]:
- No existe nada de seguimientos. Solo quedaron las columnas `last_inbound_at` y
  `last_agent_reply_at` "para la Fase C (follow-ups)".
- La última migración es la **0036** (Anuncios; la 0030 quedó vacía). La Fase E tiene pendiente
  borrar `ai_config.daily_budget_usd` en la primera migración después de Anuncios, así que los
  seguimientos toman **el siguiente número libre al construir (0037 o 0038)** (`docs/migraciones.md`).

---

## 4. La sección "Seguimientos" en Agente IA

### 4.1 Quién la ve y la edita

- **Owner, admin y vendedores** pueden crear, editar, encender/apagar y borrar seguimientos.
  - Esto necesita un permiso nuevo, `followUp`, en `lib/auth/permissions.ts`.
  - Hoy los vendedores no entran a Agente IA. Con este cambio ven la pestaña, pero **solo con la
    sección Seguimientos**. Crear/Modelos/Instrucciones/FAQs e Implementar siguen siendo de
    owner/admin (decisión 5).
- Los **predeterminados** no se pueden borrar, solo apagar y editar, igual que los workflows de
  Automatización.
- Crear o sincronizar **plantillas** sigue siendo de owner/admin, en Mensajes rápidos. En un
  seguimiento cualquiera puede **elegir** una plantilla ya aprobada.

### 4.2 Lista

Una tarjeta por seguimiento, en el mismo estilo que Automatización:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ El contacto dejó de responder                          [●  Encendido]    │
│ 2 días después del último mensaje del bot sin respuesta · 1 intento      │
│ Redacta la IA · lun–dom 8:00–18:00 (hora del contacto)                   │
│ Sin ventana: plantilla seguimiento_interes   ⚠ falta aprobarla           │
│ Programados ahora: 37                                  Editar · (Borrar) │
└──────────────────────────────────────────────────────────────────────────┘
[+ Nuevo seguimiento]
```

- El aviso ámbar sale si el seguimiento pide una plantilla que no existe o no está aprobada.
  Mientras tanto, a esas conversaciones se les avisa al vendedor en vez de mandar algo.
- "Programados ahora" es el único número de la tarjeta (menos datos es mejor).

### 4.3 Campos de cada seguimiento

| Campo | Valores | Notas |
|---|---|---|
| **Nombre** | texto | — |
| **Cuándo se dispara** | Dejó de responder · Pidió hablar con un asesor · Está ocupado · Lo que el cliente pidió en el chat · Por etapa | Cada tipo se explica en la §4.4 |
| Etapa que lo dispara | una de las 5 | Solo con "Por etapa" |
| **Espera** | minutos, horas o días | Dejó de responder: se cuenta desde el último mensaje del bot. Pidió asesor: desde el aviso. Ocupado: desde que el bot lo detecta. Por etapa: desde que entró a la etapa. "Lo que el cliente pidió" no tiene espera: usa la fecha que dio el cliente |
| **Intentos** | 1 a 3 | Cada intento espera lo mismo, contado desde el anterior. Si el cliente contesta, ya no sigue |
| **Horario** | días (lun–dom) + desde/hasta | Si la hora cae fuera, pasa a la siguiente apertura (ej. 20:00 → 8:00 del día siguiente) |
| **Zona horaria** | Hora del contacto (por su lada) · Hora de Mazatlán | "Del contacto" = el estado de su lada traducido a zona horaria (Tijuana, Hermosillo, Mazatlán, CDMX o Cancún). Sin lada mexicana, Mazatlán (decisión 4) |
| **Mensaje dentro de la ventana** | Lo redacta la IA · Texto fijo | IA: se le da una indicación de "qué debe lograr" (§4.4). Texto fijo: como un Fragmento, con `{{contacto.nombre}}` |
| **Si ya no hay ventana** | Mandar plantilla (elegir cuál) · No mandar y avisar al vendedor | Con plantilla elegida pero no aprobada, avisa al vendedor |
| **Adelantar para que caiga dentro de la ventana** | sí / no | §6.2. No se ofrece en "Lo que el cliente pidió": no se le escribe antes del día que pidió |
| **Aplica en las etapas** | casillas de las 5 | Por defecto todas menos Compra |
| **Se cancela si…** | el cliente contesta ✓ · un vendedor contesta ✓ · el bot está apagado ✓ · el contacto llega a Compra ✓ | Casillas, todas marcadas por defecto (§4.5) |
| Solo contactos de prueba | sí / no (escondido, "Avanzado") | Para probar en el número oficial sin tocar clientes (§9.2) |

### 4.4 Predeterminados

**Los 3 de Ángela, con sus mismos tiempos:**

| # | Nombre | Se dispara cuando… | Espera | Intentos | Mensaje | Horario | Estado de fábrica |
|---|---|---|---|---|---|---|---|
| 1 | **El contacto dejó de responder** | El bot mandó su último mensaje y el cliente no contestó | 2 días | 1 | IA | lun–dom 8:00–18:00, hora del contacto | **Encendido** |
| 2 | **Solicitud de contacto** | El bot avisó "el cliente pide hablar con una persona" (`aviso_vendedor` con `cliente_pide_humano`) y ningún vendedor contestó | 2 horas | 1 | IA | igual | **Encendido** |
| 3 | **El contacto está ocupado** | El bot detecta "ahorita no puedo, estoy manejando" (acción `programar_seguimiento` con motivo `ocupado`, sin fecha) | 2 horas | 1 | IA | igual | **Apagado** |

"Qué debe lograr el mensaje" (indicación para la IA; se edita en el formulario):
1. *Dejó de responder:* "Pregunta con amabilidad si sigue interesado y ofrece ayuda con lo último que
   quedó pendiente (medidas, cotización o pago). Sin presionar."
2. *Solicitud de contacto:* "Discúlpate por la espera, confirma que un asesor lo atenderá pronto y
   pregunta si mientras tanto le ayudas con algo." Además, **el aviso 🤖 al vendedor se repite**
   ("Sigue esperando a un asesor desde hace 2 h") y la conversación sube en la lista. El aviso se
   repite aunque el cliente haya escrito, porque lo que falta es el vendedor.
3. *Ocupado:* "Retoma con amabilidad, sin presionar, y pregunta si ahora tiene un momento."

> Si en GHL "Solicitud de contacto" quería decir "el cliente pidió que lo contacten después", ese
> caso lo cubre el seguimiento 4.

**Nuevos (no existían en GHL):**

| # | Nombre | Se dispara cuando… | Espera | Mensaje | Estado de fábrica |
|---|---|---|---|---|---|
| 4 | **Lo que el cliente pidió** | El cliente pide una fecha u hora ("escríbeme el lunes", "mañana te confirmo") y el bot usa `programar_seguimiento` con motivo `cliente_lo_pidio` | La fecha que pidió (sin hora: 10:00) | IA, con la nota de lo pendiente. Sin ventana: plantilla `seguimiento_acordado` | **Encendido** (decisión 7) |
| 5 | **Cotización sin respuesta** | Etapa **Interesado** | 1 día | IA. Sin ventana: plantilla `seguimiento_cotizacion` | Apagado |
| 6 | **Datos bancarios sin comprobante** | Etapa **Cerca de compra** | 1 día | IA. Sin ventana: plantilla `recordatorio_pago` | Apagado |

- "Cambio dinámico de canal" de GHL **no aplica**: el CRM solo tiene WhatsApp.
- Otras opciones de Ángela y cómo están hoy en el CRM (fuera de este diseño; se anotan para no
  perderlas):

| Opción de Ángela | CRM hoy |
|---|---|
| Espera 10 s antes de responder | 15 s |
| Máximo 50 mensajes por conversación | Sin tope (decisión de la Fase B) |
| Se duerme si un asesor escribe | Igual, hasta "Reactivar" o la hora de "Apagar bot" |
| 24/7 | Igual |
| Imágenes | Sí |
| Audios | El bot solo ve "[audio]", no lo escucha |
| Al pedir asesor: etiqueta, tarea y reactivar a las 8 h | Aviso 🤖 y el bot sigue activo (decisión de la Fase B) |

### 4.5 Cuándo se cancela

Una conversación tiene **como máximo UN seguimiento pendiente**. Prioridad: *Lo que el cliente pidió*
> *Ocupado* > *Pidió asesor* > *Por etapa* > *Dejó de responder*. Uno nuevo de mayor o igual
prioridad **reemplaza** al pendiente. Uno de menor prioridad no se programa. Así, si el cliente pidió
"escríbeme el lunes", el "dejó de responder" no le escribe el sábado.

| Motivo | Qué lo detecta | Qué pasa |
|---|---|---|
| **El cliente contesta** | la ingesta de un entrante | Se cancela, salvo "Lo que el cliente pidió": un "ok, gracias" no debe borrar "escríbeme el lunes". En ese caso decide el bot, que ve el pendiente en su contexto y lo cancela o lo cambia (§5) |
| **Un vendedor contesta** (Bandeja, programado, comando o app del celular) | la pausa por respuesta humana | Se cancela: el vendedor tomó el chat. Si quiere, programa el suyo con 🕒 |
| **Bot apagado** (Apagar bot, Reactivar pendiente, canal apagado) | se revisa **al llegar la hora** | Se cancela. "Lo que el cliente pidió" no se cancela en silencio: deja un aviso 🤖 "Hoy le tocaba el seguimiento que pidió el cliente: *confirmar medidas*" |
| **Llega a Compra** | cambio de etapa | Se cancela |
| **Sale de las etapas del seguimiento** | se revisa al llegar la hora | Se cancela |
| **El cliente ya no quiere** | el bot (`cancelar_seguimiento` con `cliente_no_quiere`), el error 131050 o el botón de la plantilla | Se cancela y el contacto queda **"sin seguimientos"** hasta que un vendedor lo quite (decisión 8) |
| **Un vendedor lo cancela** | botón en el chat | Se cancela y no vuelve a salir |
| **Se apagó o se borró el seguimiento** | al llegar la hora | Se cancela |

### 4.6 Qué pasa al llegar la hora (paso a paso)

1. Se **reclama** (programado → enviando), igual que un programado de hoy.
2. Se revisa todo de nuevo: seguimiento encendido, bot activo, canal en auto, etapa permitida y no
   Compra, contacto sin "sin seguimientos", sin vendedor ni cliente nuevos desde que se programó
   (según las casillas), y que el bot no esté contestando en ese momento (mismo candado de la
   conversación). Si algo falla, se **cancela con motivo**.
3. **¿Hay ventana de 24 h?**
   - **Sí:** con "Lo redacta la IA", se llama a la IA de esa etapa (§5.4) y sale **un solo mensaje**
     como del bot (`source: ai_agent`). Con "Texto fijo", sale el texto con el nombre.
   - **No, y tiene plantilla aprobada:** sale la plantilla con `{{1}}` = primer nombre del contacto
     (sin nombre: "de nuevo", para que se lea "Hola de nuevo, …"), como del bot.
   - **No, y no hay plantilla** (o no está aprobada, o eligieron "avisar"): **no sale nada**. Queda el
     aviso 🤖: "Seguimiento sin enviar: ya pasaron 24 h desde el último mensaje del cliente. Mándale
     una plantilla desde el chat o escríbele desde el celular." La conversación sube en la lista.
4. Lo que sale **no pausa al bot**, no marca leído y no cuenta como primera respuesta humana.
5. Si faltan intentos, se programa el siguiente.
6. Errores de Meta:
   - **131049** (tope de marketing): aviso, sin reintento.
   - **131050** (el cliente se dio de baja): el contacto queda "sin seguimientos".
   - **132015 / 132016** (plantilla pausada o deshabilitada): aviso, y la tarjeta del seguimiento lo
     marca en ámbar.
   - Cualquier otro rechazo se guarda en `error_code` y se ve en el chat.

---

## 5. El bot programa seguimientos desde el chat

### 5.1 Acciones internas nuevas (como `mover_etapa`)

Salen en la **misma llamada** que genera la respuesta, así que no cuestan una llamada extra. El
cliente nunca las ve.

```
programar_seguimiento({
  motivo: "cliente_lo_pidio" | "ocupado",   // "ocupado" solo si el seguimiento 3 está encendido
  cuando: "2026-09-29T10:00" | null,        // hora de Mazatlán; null = la espera del seguimiento
  nota:   "confirmar medidas del portón"    // ≤ 200 caracteres: qué quedó pendiente
})

cancelar_seguimiento({
  motivo: "ya_no_hace_falta" | "cliente_no_quiere"
})
```

- **Validación en el CRM:**
  - `cuando` tiene que ser futuro y a menos de 60 días (el mismo tope de los programados).
  - Se ajusta al horario del seguimiento.
  - Si el cliente pidió una hora fuera de horario, se respeta el día y se mueve a la apertura más
    cercana.
  - Con `cliente_lo_pidio`, `cuando` es obligatorio.
- `cancelar_seguimiento` con `cliente_no_quiere` marca al contacto "sin seguimientos".
- **"Pidió asesor"** no necesita acción nueva: se engancha al `aviso_vendedor(cliente_pide_humano)`
  que ya existe.
- **"Dejó de responder"** tampoco: lo programa el CRM cada vez que el bot termina de contestar
  (el mismo punto donde hoy se guarda `last_agent_reply_at`), y **mueve** el pendiente si ya había uno.
- Las herramientas nuevas van **al final** de la lista, igual que las fijas de hoy, para no romper la
  caché del prompt. Solo cambian al encender o apagar el seguimiento 3 o el 4.

### 5.2 Lo que el agente recibe en su contexto

Al bloque "[CONTEXTO DEL CRM — no lo menciones literalmente]" que ya va al final del último turno
del cliente se le agrega:

```
Fecha y hora (Mazatlán): jueves 25-sep-2026, 14:05
Seguimiento pendiente: lunes 29-sep 10:00 — confirmar medidas del portón (lo pidió el cliente)
```

Sin la fecha, el modelo no puede convertir "el lunes" en una fecha. La fecha no va en el system,
para no romper la caché.

### 5.3 Texto para el Goal (el dueño lo pega a mano, como en la Fase D)

```
SEGUIMIENTOS

Si el cliente te pide que le escribas después ("escríbeme el lunes", "mañana te confirmo", "en la tarde lo reviso"), dile que con gusto y programa el seguimiento con programar_seguimiento: motivo cliente_lo_pidio, la fecha y hora que pidió (si no dio hora, a las 10:00) y en la nota qué quedó pendiente. Usa la fecha y hora del contexto del CRM para calcular el día.

Si ya hay un seguimiento pendiente y el cliente cambia el día, vuelve a programarlo con la fecha nueva. Si ya no hace falta (el cliente ya resolvió lo pendiente), usa cancelar_seguimiento con motivo ya_no_hace_falta.

Si el cliente dice que está ocupado y no puede atender ahora, sin dar fecha, usa programar_seguimiento con motivo ocupado y sin fecha.

Si el cliente dice que ya no le interesa o que no le escribas más, respeta su decisión, despídete con amabilidad y usa cancelar_seguimiento con motivo cliente_no_quiere.
```

### 5.4 Cómo redacta la IA el seguimiento

- Es la misma llamada del cerebro de hoy: el Goal, las FAQs, el historial y el modelo de la etapa
  (Modelo 1 o 2). Cambian dos cosas:
  - **Sin herramientas**: un seguimiento no mueve etapas ni manda archivos.
  - Al final va una nota del CRM, que cumple la regla de la Fase E de que el historial termine en un
    turno del cliente:
    ```
    [SEGUIMIENTO DEL CRM — no lo menciones literalmente] El cliente no ha respondido desde el jueves 25-sep a las 14:05 (2 días). Escribe UN solo mensaje corto (máximo 2 líneas) para retomar la conversación: <qué debe lograr>. No repitas información ni archivos que ya enviaste.
    ```
- Sale **una burbuja** (tope de 320 caracteres). El gasto se registra en `ai_usage` como cualquier
  respuesta del bot, así que aparece en el Dashboard.
- Si la IA falla, **no se reintenta pagando**: queda el aviso 🤖 "No se pudo redactar el
  seguimiento" (misma regla del reenvío seguro de la Fase E).

### 5.5 Cómo lo ve y lo cancela el vendedor en la Bandeja

- **En el chat** (Bandeja y pop-up del Embudo), abajo, donde hoy salen los programados, va una
  burbuja punteada:
  ```
  🤖 Seguimiento · lunes 29-sep, 10:00 · Lo que el cliente pidió: confirmar medidas del portón
     Si ya no hay ventana: plantilla seguimiento_acordado                        [Cancelar]
  ```
  - "Cancelar" lo puede usar cualquier miembro. Cuando el seguimiento sale, la burbuja se vuelve el
    mensaje real.
  - Los cancelados **no** se muestran (menos datos), salvo los que dejan aviso 🤖.
- Sin columnas, íconos ni datos nuevos en la lista de conversaciones ni en el panel de contacto.
- "Sin seguimientos" se ve y se quita en el Detalle del contacto (una línea: "🤖 Sin seguimientos
  automáticos · Quitar").

---

## 6. Estrategia para el límite de Meta

### 6.1 Qué se manda gratis o barato

| Momento | Qué se puede mandar | Costo desde el 1-oct-2026 |
|---|---|---|
| Dentro de las **72 h de un anuncio** | Lo que sea (fuera de las 24 h, solo plantilla) | **Gratis** |
| Dentro de las **24 h** | Texto de la IA | MX$0.16 (después de 1,000 gratis al mes) + IA ~MX$0.05 con Luna (hasta ~MX$0.90 con Sonnet 5) |
| **Fuera de las 24 h** | Solo plantilla | Marketing **MX$0.73**; utilidad MX$0.16 |
| Un vendedor **desde la app del celular** | Lo que sea, sin límite de ventana | **Gratis** |

Conclusión: un seguimiento **dentro de la ventana** cuesta ~3.5 veces menos que uno con plantilla de
marketing, no necesita que Meta apruebe nada y no cuenta para el tope de marketing por persona [M6].

### 6.2 Adelantar

Con "Adelantar" encendido, al programar se revisa si la hora cae **después** de que se cierre la
ventana de 24 h (`window_expires_at`). Si cae después:
- Se mueve a la **última hora dentro del horario** que quede **al menos 30 min antes** del cierre.
- Tiene que quedar **al menos 3 h** después del último mensaje del bot, para no escribirle encima.
- Si no hay hora que cumpla las dos cosas (por ejemplo, el cliente escribió a las 3:00 y la ventana
  cierra a las 3:00 del día siguiente, fuera de horario), no se adelanta y aplica "Si ya no hay
  ventana".

**Ejemplo con "dejó de responder":**
- El cliente escribió el martes a las 16:00 y el bot le contestó a las 16:01.
- Sin adelantar, el seguimiento sale el jueves a las 16:01. Ya no hay ventana, así que va con
  plantilla de marketing (MX$0.73), o gratis si llegó por anuncio y todavía está en sus 72 h.
- Adelantado, sale el **miércoles a las 15:30** con texto de la IA (~MX$0.20).

**Recomendación (decisión 2):** "Dejó de responder" con **2 intentos de 1 día** y adelantar
encendido:
- **1.º:** ~22–23 h después, dentro de la ventana, redactado por la IA.
- **2.º:** 1 día después del primero (~2 días del último mensaje, el tiempo de GHL), con plantilla,
  solo si sigue sin contestar.

Es lo que hacía Ángela, más un recordatorio barato antes. De fábrica queda igual que GHL
(2 días, 1 intento) hasta que el dueño decida.

### 6.3 Cuando ya no hay ventana

En este orden:
1. **Plantilla aprobada** elegida en el seguimiento: sale como del bot. Si el contacto está en sus 72 h
   de anuncio, sale gratis.
2. **Sin plantilla aprobada:** no sale nada. Aviso 🤖 al vendedor, que decide si manda una plantilla
   desde el chat (📄) o le escribe **gratis desde la app del celular**, donde no hay ventana [M15].
3. El día del número oficial, **hasta que Meta apruebe las plantillas**, todos los seguimientos
   fuera de ventana caen en el punto 2. Nada falla en silencio.

### 6.4 Cuidar el número (topes fijos del CRM, no se editan)

- Máximo **1 plantilla de seguimiento por contacto cada 7 días**. Si toca otra antes, queda el aviso
  al vendedor.
- Máximo **3 seguimientos automáticos seguidos sin respuesta** del cliente, sumando todos los
  seguimientos. Después, silencio hasta que el cliente escriba.
- Un 131049 o un 131050 **nunca** se reintenta solo.
- Las plantillas de marketing llevan un botón de respuesta rápida **"Ya no me interesa"**.
  - Al tocarlo, el contacto queda "sin seguimientos" (decisión 8).
  - Un botón fijo sí se puede mandar desde el CRM: el marcado `unsupported` solo aplica a
    variables en el encabezado o en botones dinámicos [C3].

---

## 7. Plantillas a crear el día del número oficial

Idioma `es_MX`, variables posicionales, `{{1}}` = nombre del contacto. Meta no deja que el texto
empiece ni termine con una variable. Estas no lo hacen. Ejemplo para la revisión: `{{1}}` = "Ana".

| # | Nombre | Categoría | Texto propuesto | Botón | La usa |
|---|---|---|---|---|---|
| 1 | `seguimiento_interes` | MARKETING | Hola {{1}}, soy Ángela de Diluvium 👋 ¿Pudiste revisar la información de las compuertas contra inundaciones? Si tienes alguna duda o quieres tu cotización, respóndeme por aquí y con gusto te ayudo. | Respuesta rápida "Ya no me interesa" | Dejó de responder (y los vendedores desde 📄) |
| 2 | `seguimiento_acordado` | MARKETING | Hola {{1}}, como quedamos, te escribo de Diluvium para dar seguimiento a tu compuerta contra inundaciones. ¿Seguimos? Respóndeme por aquí y te atiendo. | "Ya no me interesa" | Lo que el cliente pidió |
| 3 | `seguimiento_cotizacion` | MARKETING | Hola {{1}}, te escribo de Diluvium para saber si pudiste revisar tu cotización de compuertas. ¿Te ayudo a resolver alguna duda o a apartar tu pedido? | "Ya no me interesa" | Cotización sin respuesta |
| 4 | `recordatorio_pago` | UTILIDAD (Meta puede pasarla a marketing, §2.4) | Hola {{1}}, te escribimos de Diluvium sobre tu pedido de compuertas. Cuando realices tu depósito, envíanos por aquí la foto del comprobante para continuar con tu envío. | — | Datos bancarios sin comprobante |

Notas:
- "Solicitud de contacto" y "Ocupado" (2 h) **siempre caen dentro de la ventana**: no necesitan
  plantilla.
- "Ángela" va escrito en la 1: una plantilla no cambia sola si se renombra al agente. Si se prefiere,
  se quita el nombre.
- **Cómo se dan de alta** (decisión 10):
  - **(a)** El owner o admin las crea en **WhatsApp Manager** de la WABA "Grupo Diluvium" **2–3 días
    antes** de conectar el número, para llegar con ellas aprobadas. *Confirmar que WhatsApp Manager
    deja crearlas en esa WABA.*
  - **(b)** Se crean desde el CRM (Mensajes rápidos → Plantillas) el mismo día, después de conectar.
    Tardan hasta 24 h en aprobarse.
  - En los dos casos: "Sincronizar" y elegirlas en cada seguimiento.

---

## 8. Costo estimado mensual

### 8.1 Supuestos (todos se pueden cambiar)

- **Volumen: los dos números del pedido no cuadran.** 400 leads **al día** son ~12,000 leads al mes,
  más que los ~9,000 mensajes entrantes al mes; el historial de GHL tiene ~10,900 contactos en total.
  Por eso hay **dos escenarios**:
  - **B = 400 leads al mes.** Cuadra con 9,000 mensajes: ~22 mensajes por lead.
  - **A = 400 leads al día**, tomado literal.
  - Decisión 1: confirmar cuál es.
- **Tarifas del 1-oct-2026 (§2.6):** marketing US$0.0397, servicio US$0.0085 (los 1,000 gratis del
  mes se los lleva el bot contestando). Tipo de cambio: 18.4 pesos por dólar.
- **Leads que dejan de responder:** el 60 % de los leads deja de contestar al menos una vez (1
  "dejó de responder" por esos leads).
  - La mitad de esos seguimientos cae dentro de las 72 h gratis de un anuncio (80 % de los leads
    llegan por anuncio).
  - El 40 % contesta al primer recordatorio.
- **Pidió asesor:** el 10 % de los leads pide un asesor y nadie le contesta en 2 h. El seguimiento
  cae dentro de la ventana.
- **Lo que el cliente pidió:** el 15 % de los leads pide que le escriban otro día. En 2 de cada 3
  casos ya no hay ventana y va con plantilla.
- **Costo de la IA por seguimiento:** Luna (Modelo 1) US$0.002–0.005; Sonnet 5 (Modelo 2)
  US$0.02–0.05, sin caché del historial porque pasaron horas. Casi todos los seguimientos caen en
  etapas de Luna. Supuesto: US$0.003 en promedio.
- "Ocupado" apagado. Por etapa apagados.

### 8.2 Seguimientos (lo nuevo)

Por cada **100 leads nuevos**:

| Concepto | Igual que GHL (2 días, 1 intento, plantilla) | Recomendado (§6.2: 1.º en ventana + 2.º con plantilla) |
|---|---|---|
| Dejó de responder | 60 × ½ pagados × US$0.0397 = **US$1.19** | 60 × (0.0085 + 0.003) = US$0.69, más 36 siguen callados × ½ × 0.0397 = US$0.71 → **US$1.40** |
| Pidió asesor | 10 × (0.0085 + 0.003) = **US$0.12** | **US$0.12** |
| Lo que el cliente pidió | 10 × 0.0397 + 5 × 0.0115 = **US$0.45** | **US$0.45** |
| **Total por 100 leads** | **US$1.76 (≈ MX$32)** | **US$1.97 (≈ MX$36)** |

| Escenario | Igual que GHL | Recomendado |
|---|---|---|
| **B:** 400 leads al mes | ~US$7 (**≈ MX$130**) | ~US$8 (**≈ MX$145**) |
| **A:** 400 leads al día (12,000 al mes) | ~US$211 (**≈ MX$3,900**) | ~US$236 (**≈ MX$4,350**) |

- El recomendado cuesta ~12 % más, pero le escribe a **todos** los que se callan en menos de un día,
  en vez de esperar dos.
- Si llegan menos leads por anuncio de lo supuesto, se aprovecha menos la ventana gratis. En el peor
  caso (ninguna plantilla gratis) el costo de las plantillas se duplica: recomendado B ≈ MX$200 y
  A ≈ MX$5,900 al mes; igual que GHL B ≈ MX$220 y A ≈ MX$6,500.

### 8.3 Para comparar: el bot contestando los ~9,000 mensajes al mes (ya existe; no es parte de este diseño)

- **Respuestas:** ~6,000 al mes (los mensajes seguidos del cliente se juntan en una respuesta), con
  ~1.3 burbujas cada una = ~7,800 mensajes salientes.
- **IA:** 70 % de las respuestas con Luna a ~US$0.002 y 30 % con Sonnet 5 a ~US$0.03 (con la caché
  del historial de la Fase E) → **~US$62 (≈ MX$1,150)** al mes.
- **Meta, servicio, desde el 1-oct:** 7,800 − 1,000 gratis = 6,800 mensajes. Si ~40 % caen en las
  72 h de un anuncio, ~4,100 cobrados × US$0.0085 → **~US$35 (≈ MX$640)** al mes. **Hoy es gratis;
  desde el 1-oct ya no.**
- **Zernio:** ~7,800 salientes < 10,000 gratis → US$0.
- **Total del bot + seguimientos, escenario B:** ~US$105 al mes (**≈ MX$1,950**).

---

## 9. Plan de prueba

### 9.1 Ya, con el número de prueba N2 (todo dentro de 24 h)

N2 es un chip propio de Diluvium en coexistencia, canal de prueba en producción [C4]. Su WABA
("Diluvium Pruebas") no tiene método de pago, así que ahí **no se pueden probar plantillas**. Hoy en
producción solo están N2 y el sandbox: una regla de prueba con espera de minutos **no toca clientes**.
Se borra antes del número oficial.

| # | Prueba | Cómo | Se espera |
|---|---|---|---|
| 1 | Dejó de responder | Regla de prueba "5 min"; el bot contesta y el cliente no | La burbuja 🤖 aparece al instante y a los 5 min llega el texto de la IA, sin pausar al bot |
| 2 | Cancelar: cliente contesta | Igual que la 1, pero el cliente contesta al minuto 2 | No sale nada; la burbuja desaparece |
| 3 | Cancelar: vendedor contesta | Escribir desde la Bandeja antes de los 5 min | Bot pausado; seguimiento cancelado |
| 4 | Cancelar: bot apagado | "Apagar bot 8 h" con un seguimiento pendiente | Cancelado al llegar la hora |
| 5 | Cancelar: Compra | Mover el contacto a Compra | Cancelado |
| 6 | Cancelar desde la Bandeja | Botón "Cancelar" | No sale |
| 7 | Lo que el cliente pidió | "escríbeme en 10 minutos" y "escríbeme mañana a las 9" | Fecha correcta en la burbuja; sale a la hora con la nota |
| 8 | Cambio de día | Después de la 7: "mejor el viernes" | Reemplazado, no duplicado |
| 9 | Ya no quiere | "ya no me interesa, no me escriban" | Cancelado; contacto "sin seguimientos"; no se programa nada más |
| 10 | Ocupado | Encender la 3 con espera de prueba; "ahorita estoy manejando" | Seguimiento sin fecha con la espera de la regla |
| 11 | Pidió asesor | "quiero hablar con una persona"; nadie contesta | A la espera: mensaje de la IA y el aviso 🤖 repetido |
| 12 | Horario | Regla con horario que ya pasó hoy | Sale en la siguiente apertura |
| 13 | Adelantar | El cliente escribe hoy a las 10:00; regla de 2 días con adelantar | Sale mañana ~9:30 dentro de la ventana |
| 14 | Sin ventana | Conversación con más de 24 h de silencio y la regla sin plantilla | No sale nada; aviso 🤖 "Seguimiento sin enviar" |
| 15 | Prioridad | Con "cliente lo pidió" pendiente, el bot contesta otra cosa | "Dejó de responder" no reemplaza al pendiente |
| 16 | Gasto | Dashboard | Las llamadas de los seguimientos aparecen en el gasto |

Además, pruebas automáticas de la lógica pura (Vitest, CLAUDE.md §7): horario y zona por lada,
adelantar, prioridad y reemplazo, topes, validación de `programar_seguimiento`, y los reintentos y
reclamo del despachador con Postgres real.

### 9.2 El día del número oficial (plantillas)

1. Confirmar el **método de pago** de la WABA "Grupo Diluvium" (§2.1).
2. Plantillas de la §7 en **APPROVED** → "Sincronizar" → elegirlas en cada seguimiento. Revisar en
   WhatsApp Manager si Meta cambió alguna categoría.
3. Seguimiento de prueba con **"Solo contactos de prueba"**, espera de 5 min y "Si ya no hay ventana:
   plantilla", contra el celular del dueño (marcado `es_prueba`). Ese celular necesita más de 24 h
   sin escribir; se prepara un día antes.
   - Se espera: llega la plantilla con el nombre y la burbuja dice "plantilla".
   - En WhatsApp Manager, el cargo aparece como marketing.
4. Tocar **"Ya no me interesa"** → el contacto queda "sin seguimientos".
5. Borrar las reglas de prueba y dejar encendidos solo los seguimientos que el dueño apruebe.
6. A los **7 días**: calidad del número y estado de las plantillas en WhatsApp Manager, y gasto real
   en el Dashboard contra la §8.

---

## 10. Decisiones para el dueño

1. **Volumen real:** ¿son ~400 leads **al mes** o **al día**? Los 9,000 mensajes al mes cuadran con
   400 al mes. *Recomendación:* confirmar con el dato de GHL. Cambia el costo de ~MX$145 a ~MX$4,350
   al mes.
2. **"Dejó de responder":** ¿igual que GHL (2 días, 1 intento, con plantilla) o 2 intentos (el 1.º
   ~22 h dentro de la ventana con IA y el 2.º ~2 días con plantilla)? *Recomendación:* 2 intentos.
   Cuesta ~12 % más y le escribe a todos antes de que se enfríen.
3. **Sin ventana y sin plantilla aprobada:** ¿no mandar y avisar al vendedor, o no mandar sin avisar?
   *Recomendación:* avisar. El vendedor decide si manda plantilla o le escribe gratis desde el
   celular.
4. **Zona horaria del horario:** ¿hora del contacto por su lada (como GHL) o hora de Mazatlán?
   *Recomendación:* la del contacto por lada, y Mazatlán si no hay lada. Evita escribirle a las 7:00
   a Tijuana o a las 20:00 a Cancún.
5. **Vendedores en Agente IA:** ¿ven la pestaña solo con Seguimientos (sin Goal, FAQs ni modelos)?
   ¿Pueden también **borrar** seguimientos, o solo crear, editar y apagar? *Recomendación:* solo
   Seguimientos, con todo menos borrar los predeterminados.
6. **Bot apagado cuando llega la hora de "Lo que el cliente pidió":** ¿cancelar, o avisar al
   vendedor? *Recomendación:* avisar ("hoy le tocaba el seguimiento que pidió el cliente"). Los otros
   seguimientos se cancelan sin aviso.
7. **Encender de fábrica "Lo que el cliente pidió"** (el bot aparta "escríbeme el lunes")?
   *Recomendación:* sí. Es lo que el dueño pidió y es el seguimiento con más probabilidad de venta.
8. **Bajas:** botón "Ya no me interesa" en las plantillas de marketing, más contacto "sin
   seguimientos" (por el bot, el botón o el error 131050), que un vendedor puede quitar.
   *Recomendación:* sí. Meta exige respetar bajas y protege la calidad del número.
9. **Topes fijos:** 1 plantilla de seguimiento por contacto cada 7 días y máximo 3 seguimientos
   seguidos sin respuesta. *Recomendación:* sí, fijos en el código (no editables), para no arriesgar
   el número.
10. **Alta de plantillas:** ¿en WhatsApp Manager 2–3 días antes de conectar el número oficial, o desde
    el CRM ese día? *Recomendación:* WhatsApp Manager antes, para llegar con ellas aprobadas. Si la
    WABA no lo permite sin número, desde el CRM ese día.
11. **Textos de las 4 plantillas** (§7), incluido si "Ángela" va en el texto. *Recomendación:* los
    propuestos, con Ángela.
12. **Categoría:** seguimientos de venta como MARKETING y solo `recordatorio_pago` como UTILIDAD.
    *Recomendación:* sí. Disfrazar marketing de utilidad tiene castigo de Meta (§2.4).
13. **Seguimientos por etapa** (Cotización sin respuesta, Datos bancarios sin comprobante): ¿se
    incluyen apagados? *Recomendación:* sí, apagados; se encienden cuando haya plantillas aprobadas.
14. **Orden de construcción:** parte 1 = todo lo de dentro de la ventana (la sección, las acciones del
    bot, la burbuja en la Bandeja y el aviso "sin ventana"), que se prueba con N2. Parte 2 = plantillas
    del bot, botón de baja y webhooks de estado, el día del número oficial. *Recomendación:* así. La
    ventana gratis de 72 h ya está en `main` (Anuncios) y se usa desde la parte 1.
15. **Método de pago en la WABA "Grupo Diluvium":** desde el 1-oct Meta lo exige para seguir
    entregando. *Recomendación:* confirmarlo en Meta Business antes del número oficial. No es del CRM,
    pero sin él no salen ni el bot ni los seguimientos.

---

## 11. Detalle técnico para construir (solo después de aprobar)

### 11.1 Datos (migración nueva: el siguiente número libre al construir, 0037 o 0038)

```
follow_up_rules           id, organization_id, name, enabled, is_system (no se borra),
                          trigger (dejo_de_responder | pidio_asesor | ocupado | cliente_lo_pidio | etapa),
                          trigger_stage (contact_stage, solo con etapa),
                          wait_minutes, attempts (1–3),
                          days smallint[] (1=lun … 7=dom), hour_from, hour_to ('08:00','18:00'),
                          time_zone_mode (contacto | mazatlan),
                          message_mode (ia | texto), ai_goal text, fixed_text text,
                          no_window (plantilla | avisar), template_id (→ templates, set null),
                          advance_into_window bool,
                          stages contact_stage[],
                          cancel_on_inbound, cancel_on_seller, cancel_on_bot_off, cancel_on_compra (bool),
                          test_contacts_only bool, position,
                          created_by_user_id, updated_by_user_id, created_at, updated_at

follow_ups                id, organization_id, conversation_id, contact_id, rule_id (set null),
                          origin (regla | agente), trigger (copia), note text,
                          attempt, send_at, priority,
                          status (scheduled | sending | sent | cancelled | failed | notified),
                          cancel_reason (cliente_contesto | vendedor_contesto | bot_apagado | compra |
                                         fuera_de_etapa | cliente_no_quiere | manual | reemplazado |
                                         regla_apagada | tope),
                          cancelled_by_user_id, created_from_message_id,
                          sent_as (texto_ia | texto_fijo | plantilla), message_id,
                          error_code, error_message, attempts_made, created_at, updated_at
                          -- índice único parcial: un solo 'scheduled' por conversation_id
                          -- índice (status, send_at) parcial para el barrido

contacts (+)              follow_ups_blocked_at timestamp, follow_ups_blocked_reason text
ai_agent_notices          kind nuevo: 'seguimiento' (kind ya es texto; sin migración de enum)
```

### 11.2 Código

- `lib/seguimientos/rules.ts` (puro, con Vitest): horario y zona por lada (usa `lib/phone-lada.ts`),
  adelantar, prioridad y reemplazo, topes, cálculo de `send_at`.
- `lib/seguimientos/store.ts`: programar, reemplazar, cancelar y listar pendientes. Todo filtrado por
  organización (`withOrg`).
- `lib/seguimientos/dispatch.ts`: reclamo, revisión y envío (IA, texto o plantilla) o aviso, con el
  mismo patrón que `lib/scheduled/dispatch.ts`, pero **sin** `pauseAgentForManualSend`.
- `lib/queue/seguimientos.ts` + `worker/seguimientos.ts`: cola `follow-ups` con retraso y barrido en
  el ciclo de 60 s.
- `lib/ai/runtime/tools.ts` + `actions.ts`: `programar_seguimiento` y `cancelar_seguimiento`.
  `crmContextFor` suma la fecha y hora y el pendiente.
- `lib/ai/runtime/follow-up-draft.ts`: la redacción (§5.4), con uso en `ai_usage`.
- `lib/messaging/send.ts`: `sendTemplateMessage` acepta `source: "ai_agent"` sin usuario.
- **Ganchos:**
  - Bot terminó de contestar → programar "dejó de responder".
  - Entrante → cancelar.
  - Pausa humana o manual → cancelar.
  - Cambio de etapa → cancelar si es Compra o programar los "por etapa".
  - `aviso_vendedor(cliente_pide_humano)` → programar.
  - Todos aislados con try/catch, como los ganchos del agente: un fallo aquí nunca frena la ingesta
    ni el envío.
- **UI:**
  - `app/(app)/agente-ia/` con la pestaña "Seguimientos" (lista y formulario).
  - Burbuja en el chat, junto a `ScheduledInThread`.
  - Línea "sin seguimientos" en el Detalle del contacto.
  - Permiso `followUp` en `lib/auth/permissions.ts`.
- **Parte 2:**
  - Webhooks `whatsapp.template.status_updated` / `category_updated`.
  - Respuesta del botón "Ya no me interesa".
  - Errores 131049, 131050, 132015 y 132016 → avisos o bloqueo.

### 11.3 Riesgos

- **El modelo convierte mal "el lunes"** (por ejemplo, un domingo en la noche): la burbuja enseña la
  fecha y el vendedor la ve. La fecha del contexto es la hora de Mazatlán.
- **Plantillas y tope de marketing:** Meta puede no entregar (131049) aunque todo esté bien. Queda
  aviso y no hay reintento.
- **La lada no es la ubicación real** (el dueño ya lo sabe por la Bandeja): en el peor caso se le
  escribe una hora antes o después.
- **Los 1,000 mensajes de servicio gratis** y la tarifa de marketing del 1-oct salen de páginas de
  Meta que cambian cada trimestre. Hay que revisar la §2.6 antes de construir.
- **Opt-in:** los leads escriben primero (anuncio o número). Un seguimiento de marketing es legal con
  ese permiso según la práctica común, pero Meta pide un permiso claro [M9]. Si un cliente reporta
  spam, baja la calidad. Por eso existen las bajas y los topes.

---

## Fuentes

Meta (leídas el 25-sep-2026):
- [M1] Precios: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing (tarifas por país enlazadas en "rate cards").
- [M2] Precios de mensajes sin plantilla (desde el 1-oct-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- [M3] Webhook de estado (`pricing.type`): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
- [M4] Webhook de mensajes (`referral`): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text
- [M5] Categorías y recategorización: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- [M6] Tope de marketing por persona: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits
- [M7] Límites de mensajería: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- [M8] Registro de cambios: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- [M9] Permiso (opt-in): https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
- [M10] Política de WhatsApp Business: https://whatsappbusiness.com/policy/
- [M11] Webhook `user_preferences` (baja de marketing): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/user_preferences
- [M12] Calidad del número: https://www.facebook.com/business/help/896873687365001
- [M13] Pausa de plantillas: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pausing/
- [M14] Códigos de error: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
- [M15] Coexistencia (app del celular): https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users

Zernio (leídas el 25-sep-2026):
- [Z1] Crear plantilla: https://docs.zernio.com/whatsapp/create-whatsapp-template.mdx
- [Z2] Guía de plantillas: https://docs.zernio.com/platforms/whatsapp/templates.mdx
- [Z3] Listar plantillas: https://docs.zernio.com/whatsapp/get-whatsapp-templates.mdx
- [Z4] Consultar una plantilla: https://docs.zernio.com/whatsapp/get-whatsapp-template.mdx
- [Z6] Webhooks de WhatsApp: https://docs.zernio.com/webhooks/whatsapp.mdx
- [Z7] Abrir conversación con plantilla: https://docs.zernio.com/messages/create-inbox-conversation.mdx
- [Z8] Enviar mensaje en el inbox: https://docs.zernio.com/messages/send-inbox-message.mdx
- [Z9] Inbox de WhatsApp: https://docs.zernio.com/platforms/whatsapp/inbox.mdx
- [Z13] WhatsApp (general): https://docs.zernio.com/platforms/whatsapp.mdx
- [Z14] Referencia de errores: https://docs.zernio.com/platforms/whatsapp/reference.mdx
- [Z15] Precios de WhatsApp en Zernio: https://docs.zernio.com/platforms/whatsapp/pricing.mdx
- [Z17] Información del número (escalón): https://docs.zernio.com/whatsapp/get-whatsapp-number-info.mdx
- [Z18] Precios de Zernio: https://docs.zernio.com/pricing.mdx

CRM:
- [C1] `main` abce8e6 (Anuncios de Meta): `lib/ads/free-window.ts`, `drizzle/0035_anuncios_meta.sql` (`conversations.ad_entry_at`), `docs/anuncios.md`.
- [C2] `docs/investigacion/plantillas-zernio.md`.
- [C3] `lib/messaging/zernio.ts` (listar, crear y enviar plantillas), `lib/messaging/send.ts` (`sendTemplateMessage`), `lib/messaging/template-format.ts` (`unsupported`).
- [C4] `docs/numero-prueba.md` (N2, WABA "Diluvium Pruebas", plantillas solo con el oficial).
- [C5] `main` ebcd981: `lib/scheduled/*`, `lib/ai/runtime/{tools,actions,run,policy,transcript}.ts`, `lib/db/schema/{scheduled,messaging,ai-runtime,ai-config,contacts}.ts`, `lib/auth/permissions.ts`, `worker/index.ts`, `drizzle/` (última 0036 tras Anuncios), `docs/migraciones.md`.
