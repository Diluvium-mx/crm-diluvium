# Seguimientos por contexto — diseño

> **Estado (2-oct-2026): el dueño aprobó la ESTRUCTURA (los 7 pasos, §4) el 30-sep y el 2-oct la TABLA DE CASOS
> (§6, los 10 casos), la hora de cada caso, el horario de 7:00 a 21:00 todos los días y el envío automático en los chats
> de vendedor, la píldora 🤖 en el hueco de la barra arriba de ⚡ 📄 📎, la pausa a mano como sugerencia y que el 1.er
> intento salga con el borrador del lector tal cual (sin gasto extra de IA).** Siguen abiertas las de la §12 (aviso de
> pago, plantillas por caso). Las plantillas de cada intento las confirma el dueño caso por caso. Parte 0 en producción
> (main d38f387). **Parte 1 (modo ensayo) en producción** (migración 0056). **3-oct-2026: revisión del ensayo en
> producción (102 fichas) y arreglos al lector** (§14, migración 0057); la Parte 2 (envío real) espera esa revisión. Se
> construye por partes (§11), cada una por staging y con "OK MAIN". Este documento **reemplaza** al del 25-sep-2026,
> que disparaba el seguimiento por tiempo ("2 días sin respuesta") y después veía qué decir: el orden correcto es al
> revés. Fuentes al final: **[M#]** Meta, **[Z#]** Zernio, **[G#]** GoHighLevel/GoGHL, **[C#]** código del CRM.

---

## 1. En corto

Cuando un chat se queda parado (el último mensaje es nuestro y el cliente ya no contesta), el Agente IA
**primero entiende qué quedó pendiente** (cotización sin respuesta, faltan medidas, pago sin comprobante, "escríbeme
el lunes"…), **después decide cuándo y qué decirle** para que avance un paso hacia comprar, y **al final** sale por
la puerta que toque:

- **Ventana de 24 h abierta:** el Agente IA le escribe un mensaje personal (texto libre). Es el 1.er intento de casi
  todos los casos: sale antes de que cierre la ventana, a la hora del caso (§6.2).
- **Ventana cerrada:** sale una **plantilla aprobada** (§7): el saludo según la hora (`hola_buenos_dias` /
  `hola_buenas_tardes`) o `seguimiento_proteccion`. Cuando el cliente contesta se abre la ventana y el Agente IA
  retoma **con el mismo contexto**: le dice lo que quedó pendiente.
- **Chats que ya tomó un vendedor:** no se manda nada solo. La ficha y el mensaje sugerido le quedan al vendedor
  para mandarlo con un clic (desde el CRM o gratis desde WhatsApp Web).

La lectura del chat la hace el **lector en segundo plano** que ya existe (Luna lee cada chat completo 3 min después
del último mensaje para llenar el Detalle y la etapa [C1]): la ficha de seguimiento sale en esa **misma lectura**,
sin una llamada extra.

---

## 2. Qué hacía GoHighLevel y por qué no se copia tal cual

- En GHL **todo** el seguimiento lo hacía la IA de Ángela (Conversation AI), no los workflows [G1][G6]. La
  configuración de hoy dice "Dejó de responder" 2 días · 1 intento, "Solicitud de contacto" 2 h, "Ocupado" apagado,
  horario 8:00–18:00 hora del contacto. **En los hechos salía a los 15 días** (§2.1).
- GHL **no tenía el WhatsApp oficial**: los mensajes salían por **GoGHL**, un programa que se conecta como un
  WhatsApp Web más (dispositivo vinculado por QR) y por eso no tenía ventana de 24 h ni plantillas [G2]. WhatsApp
  prohíbe ese tipo de conexión y puede bloquear el número [M9][M10]. Hoy el mismo número sostiene el CRM, el Agente IA,
  Zernio y los anuncios: **no se conecta un programa así** (decisión informada al dueño el 28-sep).
- Con WhatsApp **oficial**, ni GHL manda el seguimiento de Ángela por WhatsApp después de 24 h: lo pasa a SMS [G3].
  Desde el 27-sep GHL sigue intentando mandar los seguimientos de Ángela y **todos fallan** (no llegan al cliente).
- De GHL oficial **sí se copia** [G4]: revisar la ventana antes de cada envío automático (rama abierta/cerrada),
  plantilla aprobada de antemano para la rama cerrada, variables llenadas con datos del contacto, cancelar si el cliente
  contesta, horario laboral y tope de intentos.

### 2.1 Lo que dice el historial completo de GHL (análisis del 1 y 2-oct-2026) [G5]

108,864 mensajes (21-mar → 1-oct); para el análisis, WhatsApp hasta el 26-sep: **10,470 contactos** que escribieron.

- **97 % de los chats terminan con un mensaje nuestro** sin respuesta: 11,366 paradas (nosotros al último, ≥24 h,
  antes de comprar), ~2,450 al mes en ago–sep.
- **Venta real** (no hay otra señal confiable): el vendedor confirma el pago ("confirmo de recibido", "gracias por su
  compra", guía) o el cliente manda el comprobante. **217 ventas, 2 % de los contactos**; 96 % con un vendedor en el
  chat. La etiqueta "venta cerrada" de GHL **no sirve**: sus 268 contactos se crearon todos del 27 al 31-ago, traen
  también "anticipo-medida-especial-recibido" y son prospectos comunes (y en GHL ninguna oportunidad quedó "ganada").
- **Embudo** (lo más lejos que llegó → compró): solo información 1 % · precio general 0.3 % · cotización personal
  3 % · **recibió datos bancarios 58 %**.
- **114 de las 217 ventas pasaron por una pausa de ≥24 h** antes de comprar: la rompió el cliente solo en 77, un
  vendedor en 30 y Ángela en 6. Dónde estaban parados: pago pendiente 43, cotización 30, precio general 20.
- **Ángela seguía a los 15 días** (los ~6,000 seguimientos, todos los meses de abril a septiembre): contestó **11 %**
  y casi nadie compró (6 ventas en 6 meses). Los **vendedores** que siguieron pronto: 20–30 h **56 %**, 30–54 h
  **71 %**, 54–100 h **72 %**, 4–8 días 52 %, 8–17 días 30 % (eligen chats más tibios: parte es correlación, pero la
  caída con el tiempo es clara).
- **Escribir cerca del cierre de la ventana casi no estorba:** el cliente que va a contestar lo hace rápido (81 % en 15 min, 96 % en
  24 h); de los que siguen callados a las 20 h, solo el 8 % contesta solo antes de las 24 h.
- **La puerta funciona:** el seguimiento de vendedor que abrió solo con un saludo ("Hola, buenos días, … de
  Diluvium 😀") contestó **57 %** y compró 19 %; con contenido, 67 % y 15 %.
- **El cuándo pesa más que el texto.** Con la misma demora (15 días), el texto de Ángela movió poco: mencionar lo
  concreto 11–30 % vs 8–16 %; ofertas 17–18 % vs 8–10 %; volver a pedir la medida 7–9 % vs 10–12 %. Lo que
  funcionó en los vendedores está en §7.3.
- **Ventana gratis de anuncio:** el 80 % de las paradas de anuncio pasan en las primeras 2 h desde que llegó; un
  intento a las ~48 h cae dentro de la ventana gratis en el 86 % de ellas.
- **Hora** (detalle por caso en §6.2): los clientes escriben de 9 a 19 h el ~74 % de sus mensajes y de 19 a 24 h el
  18 %; los pagos llegan de 9 a 19 h (95 %); nuestros mensajes de 19 a 21 h se contestan más rápido. Lunes es el día con más
  mensajes (19 %); sábado 10 %, domingo 11 %. Los vendedores nunca mandaron seguimientos en domingo.

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

**Plantillas (2-oct-2026):** en Meta hay **3 aprobadas** (Marketing, es_MX): `hola_buenos_dias` ("Hola, buenos
días."), `hola_buenas_tardes` ("Hola, buenas tardes.") y `seguimiento_proteccion` ("Buenas, aquí reportándonos
respecto a lo que platicamos acerca de la protección. ¿Qué le pareció?"). **La tabla de casos funciona solo con esas
3.** Las 8 plantillas por caso que se propusieron el 1-oct se dieron de alta sin autorización y se **borraron** el
2-oct.

**Plantillas propias por caso (3-oct-2026):** el dueño escribió los textos (su ortografía tal cual, más natural) y
dio el sí a la lista; se dieron de alta en Meta ese día (PENDING). Marketing, es_MX. En 4 de ellas `{{1}}` **no es el
nombre** sino **cuándo nos escribió el cliente**, calculado por el CRM en su calendario (`lib/followups/time-phrase.ts`):
"hoy", "el día de ayer", "anoche" (después de las 19:00), "antier", "el lunes"… (3–6 días), "la semana pasada",
"hace unas semanas" o "hace un tiempo"; siempre en minúsculas. Ejemplo para Meta: "el día de ayer".

| Plantilla | Casos | Texto |
|---|---|---|
| `seg_precio` | Precio sin respuesta | Hola, le escribo de parte del equipo de Diluvium. Referente a la compuerta que nos comento {{1}}. ¿Pudo ver la información de la compuerta? |
| `seg_informacion` | Solo información | Hola, le escribo de parte del equipo de Diluvium. Referente a la compuerta que nos comento {{1}}. ¿Se le mete el agua en su casa? Unos 30, 40 cm? |
| `seg_valorar` | Cotización, pago pendiente, pidió fecha | Referente a la compuerta anti-inundaciones que nos comentó {{1}}. Tuvo oportunidad de valorar la compra? Qué le pareció? |
| `seg_medidas` | Faltan medidas | Referente a la compuerta anti-inundaciones que nos comentó {{1}}. Tuvo oportunidad de medir la entrada? Para saber que tamaño de compuerta le queda? |
| `seg_asesor` | Asesor sin respuesta | Hola, le escribo de parte del equipo de Diluvium para atender su consulta, dígame, en que le puedo ayudar? |
| `seg_objecion` | Lo va a pensar u objeción | Hola, le escribo de parte del equipo de Diluvium. Tuvo la oportunidad de pensarlo con calma? Si le queda alguna duda sobre la compuerta, con gusto se la resuelvo aquí mismo. |
| `seg_info_duda` | Solo información (2.º intento; aprobada por el dueño el 3-oct-2026) | Hola, le escribo de parte del equipo de Diluvium. Referente a la compuerta que nos comento {{1}}. Le quedo alguna duda que le pueda resolver? |

Salen en el 1.er intento (si ya no hay ventana) y en el 2.º, **solo cuando Meta ya las aprobó**; mientras están en
revisión, o si se rechazan, sale la puerta de respaldo (🚪 / 📄). El 3.er intento sigue con 🚪 o 📄 (otro texto, para no
repetir). Sin caso propio: "Sin punto claro" (🚪). En el 📄 y el 🕒 de la caja para escribir, el `{{1}}` de estas 4
plantillas ya viene con la frase de tiempo (se puede cambiar); las demás siguen con el primer nombre.

---

## 4. El orden correcto (7 pasos)

1. **Detectar que el chat se quedó parado.** El último mensaje es **nuestro** (Agente IA, vendedor o workflow) y el
   cliente no contesta. Si el último es del cliente, no hay seguimiento: toca contestarle.
2. **Revisar el chat completo y llenar la ficha de seguimiento** (§5). La llena el lector en la misma lectura que
   ya hace para el Detalle. La ficha dice qué quedó pendiente, qué puntos están claros, qué falta para que sea cliente
   potencial, si vale la pena, cuándo y un borrador del mensaje.
3. **Decidir cuándo según el caso** (§6): cada caso tiene su momento y su objetivo. Si el cliente pidió una fecha,
   manda esa fecha. Todo cae dentro del horario (§9). Un chat tiene como máximo **un** seguimiento pendiente; una ficha
   nueva reemplaza a la anterior.
4. **Al llegar la hora, volver a revisar y salir por la puerta que toque** (§7). Si el cliente escribió, un vendedor
   contestó o el contacto ya compró, se cancela. Si sigue en pie, el Agente IA actualiza el mensaje con lo más
   reciente y sale: ventana abierta → texto; cerrada → plantilla.
5. **Si contesta:** el Agente IA sigue sabiendo por qué le escribió ("le escribí por su cotización") y empuja el
   siguiente paso de la ficha. La etapa y el Detalle los sigue moviendo el lector.
6. **Si no contesta:** el siguiente intento del caso (hasta **3** en los casos que venden, **2** en el resto, §6).
   Después se detiene: la temperatura pasa a **frío** y, en pago pendiente y asesor sin respuesta, queda un aviso 🤖
   para el vendedor.
7. **Visible y medible:** en el chat se ve el seguimiento programado con su motivo (Ver mensaje · Cambiar hora ·
   Cancelar); en Agente IA › Seguimientos se editan los casos; en el Dashboard, cuántos contestaron, cuántos avanzaron
   de etapa y cuántos compraron.

---

## 5. La ficha de seguimiento

La devuelve el lector, en la misma herramienta `actualizar_contacto`, **solo cuando el último mensaje es nuestro**:

| Campo | Qué es | Ejemplo |
|---|---|---|
| `caso` | Qué quedó pendiente (uno de la §6) | `cotizacion_sin_respuesta` |
| `pendiente` | En una línea, lo que quedó abierto | "Se le cotizaron 2 compuertas de 90 cm ($11,000) y no respondió" |
| `siguiente_paso` | Lo que lo acerca a comprar | "Resolver su duda de instalación y ofrecer los datos de pago" |
| `vale_la_pena` + `motivo` | No, si dijo que no, ya compró, no es de México, pidió que no le escriban o es el contestador de otro negocio | `false` · "Dijo que ya lo compró en otro lado" |
| `fecha_pedida` | Si el cliente pidió que le escribieran en una fecha u hora ("el lunes", "en la quincena", "al rato") | "2026-10-05T10:00" (hora de Mazatlán) |
| `borrador` | El mensaje personal, corto (máx. 2 líneas), con las reglas de §7.3 | "Hola Ana, buenos días. ¿Pudo revisar la cotización de sus 2 compuertas de 90 cm? Si le queda alguna duda de la instalación, se la resuelvo por aquí." |

**El `caso` se cruza con datos duros del CRM** (el modelo propone, el código confirma):
- Aviso abierto de "pasar a un asesor" / "el cliente pide una persona" sin respuesta humana después → `asesor_sin_respuesta`.
- Etapa con papel **Cerca de compra** y `pago_total` vacío o menor que `monto_cotizacion` → `pago_pendiente`.
- Etapa con papel **Venta cerrada**, o ya pagó el total → `no_seguir` (es postventa).
- Detalle con medidas (`anchos_cm`) y `monto_cotizacion` → al menos `cotizacion_sin_respuesta` (salvo que el modelo
  vea pidió fecha, objeción o no seguir, que van encima).
- Si dos casos aplican, gana el primero de la tabla de §6 (está en orden de prioridad).

**Puntos claros** (✓/✗) **no los inventa el modelo**: salen del Detalle guardado — problema de inundación, número
de entradas, medidas, nivel de agua, cotización enviada, pago. Sirven para dos cosas:
- el `siguiente_paso` apunta al **primer punto que falta** (o a cerrar la venta si todo está claro);
- los chats **con todos los puntos claros** van primero (son los más cerca de comprar).

---

## 6. Tabla de casos (fábrica; se editan en Agente IA › Seguimientos)

**Horario permitido: 7:00 a 21:00, hora del cliente** (decisión del dueño, 2-oct). Dentro de ese horario, **cada caso
tiene su hora** (columna "Hora"; los datos en §6.2), porque no es lo mismo pedir medidas (de noche, ya en su casa)
que pedir un comprobante (en la mañana, para que alcance a pagar ese día).

**Tiempos**, contados desde nuestro último mensaje (la parada):
- **Antes del cierre** (1.er intento, texto del Agente IA): la primera hora del caso que caiga **después de 8 h de
  silencio** y **al menos 1 h antes de que cierre la ventana de 24 h**. Si ninguna hora del caso cabe, la última hora
  permitida (7:00–21:00) antes del cierre. Si tampoco cabe, sale con plantilla al día siguiente a la hora del caso.
  Ejemplos con "Faltan medidas" (19:00–20:30): quedó parado a las 12:00 → sale a las 20:00 del mismo día; a las
  21:00 → sale a las 19:00 del día siguiente; a las 16:00 → la noche de hoy queda a menos de 8 h y la de mañana ya
  pasa el cierre, así que sale a las 15:00 de mañana (la última hora antes del cierre).
- **Día 2** = 2 días después de la parada, a la hora del caso.
- **Día 9** = 7 días después del 2.º intento, a la hora del caso (nunca dos plantillas al mismo contacto en menos de
  7 días, §9).
- Si un intento ya salió con plantilla, el siguiente con plantilla espera 7 días.
- **Con plantilla, nunca después de las 19:00**: una plantilla de noche que no es respuesta del Agente IA es rara
  (decisión del dueño, 2-oct). En los casos de noche, la plantilla sale de 18:00 a 19:00.

**Puertas** (solo cuando la ventana está cerrada): 🚪 = `hola_buenos_dias` antes de las 12:00 hora del cliente,
`hola_buenas_tardes` después · 📄 = `seguimiento_proteccion`. Con la ventana abierta, siempre texto del Agente IA.
La plantilla de cada intento es propuesta: **el dueño la confirma caso por caso** antes de la Parte 3.

| # | Caso (`caso`) | Cómo se detecta en el chat | Hora (del cliente) | 1.er intento | 2.º intento | 3.er intento | Qué busca el mensaje |
|---|---|---|---|---|---|---|---|
| 0 | **No seguir** (`no_seguir`) | Dijo que no o que ya compró (aquí o en Mercado Libre, Amazon, una tienda); pidió envío al extranjero y ya se le dijo que no se envía, aunque tenga a alguien en México; pidió que no le escriban; número equivocado o anuncio por error; contesta el contestador de otro negocio; ya compró (etapa Venta cerrada o pagó el total) | — | Nunca | — | — | — |
| 1 | **Asesor sin respuesta** (`asesor_sin_respuesta`) | Aviso abierto "pasar a un asesor" / "el cliente pide una persona" (tarjeta amarilla) y ningún vendedor le contestó | 1.º: 2 h después (7:00–21:00) · luego 10:00 | **2 h** (texto): el Agente IA se disculpa por la espera y resuelve lo que pueda. Al vendedor ya le avisó la tarjeta amarilla al instante | Día 2 · 🚪 | — | Que no se quede colgado y lo atienda un vendedor |
| 2 | **Pidió que le escribieran** (`pidio_fecha`) | El cliente dijo cuándo sigue, aunque sin hora exacta ("mañana mido", "en la tarde se la mando", "el domingo que regrese", "el lunes", "en la quincena", "no estoy en casa"); "estoy ocupado / al rato" sin más = +3 h; "en la quincena" = el próximo día 15 o último del mes; "cuando pueda" sin día NO es fecha | La que pidió (mañana 10:00 · tarde 18:00 · noche o "cuando llegue a casa" 19:30) · solo el día: **la hora de lo pendiente** (medidas 19:00, pago 10:00…; sin asunto, 11:00) | **La fecha y hora que pidió**. Texto si la ventana sigue abierta; si no, 🚪 | +2 días · 🚪 (o +7 días si el 1.º ya fue plantilla) | +7 días · la plantilla que mejor encaje (solo si el 1.º fue texto) | Retomar justo como quedaron |
| 3 | **Pago pendiente** (`pago_pendiente`) | Recibió los datos bancarios (etapa Cerca de compra) y no ha mandado comprobante, o falta el resto del pago | 10:00 | Antes del cierre · texto | Día 2 · 🚪 | Día 9 · la plantilla que mejor encaje | El comprobante, o resolver lo que lo frena (forma de pago, tarjeta, fecha de entrega) |
| 4 | **Lo va a pensar u objeción** (`objecion`) | Lo último del cliente: "lo platico con mi esposo", "lo pienso", "está caro", "ahorita no", "más adelante" (sin fecha) | 19:00–20:30 | Antes del cierre · texto | Día 2 · 📄 | Día 9 · 🚪 | Responder esa duda u objeción con algo útil (video, opción, comparación) |
| 5 | **Cotización sin respuesta** (`cotizacion_sin_respuesta`) | Dio medidas y se le dijo talla y precio para SU entrada (Detalle con medidas y monto); no llegó a datos bancarios | 18:00–20:00 | Antes del cierre · texto | Día 2 · 📄 | Día 9 · 🚪 | Resolver la duda que lo frena (instalación, envío, si le queda) y ofrecer los datos de pago |
| 6 | **Faltan medidas** (`faltan_medidas`) | Se le pidió el ancho (o una foto) y no lo dio; Detalle sin medidas | 19:00–20:30 | Antes del cierre · texto | Día 2 · 🚪 | — | Pedir exactamente el dato que falta, con cómo medir (de lado a lado, en cm), ahora que está en casa |
| 7 | **Precio sin respuesta** (`precio_sin_respuesta`) | El CLIENTE preguntó el precio, lo recibió (por workflow o por el Agente IA) y no dio medidas ni siguió | 19:00–21:00 | Antes del cierre · texto | Día 2 · 🚪 | — (apagado de fábrica) | Saber dónde lo usaría (puerta, cochera, local) y si se le mete el agua; no volver a pedir la medida si ya se pidió |
| 8 | **Solo información** (`solo_informacion`) | Solo mandó el texto del anuncio o un saludo y recibió la información (aunque traiga el precio), sin preguntar el precio él | 19:00–21:00 | Antes del cierre · texto | Día 2 · 🚪 | — | Calificar: dónde lo usaría y si se le mete el agua |
| 9 | **Sin punto claro** (`sin_punto_claro`) | Ninguno de los anteriores | 18:00–20:00 | Antes del cierre · texto | Día 2 · 🚪 | — | Reenganchar con una pregunta sobre su caso |

Después del último intento sin respuesta: temperatura **frío**. En **pago pendiente** y **asesor sin respuesta**
queda además un aviso 🤖 al vendedor (~1 al día con los volúmenes de GHL; cuándo y con qué color, §12). Si el cliente contesta
en medio, el seguimiento se cancela y la siguiente lectura hace una ficha nueva.

### 6.1 Por qué estos tiempos (números de GHL, §2.1)

| Caso | Paradas al mes (ago–sep) | Compró después de la parada | Regresa solo en 1–5 días | Seguimiento de vendedor en 1–5 días: contestó · compró | Ángela a los 15 días: contestó |
|---|---|---|---|---|---|
| Asesor sin respuesta | 8 | 2 % | 10 % | 70 % · 7 % | 32 % |
| Pidió fecha | ~75 | **7 %** | regresa 31 %, pero tarda (mediana 7.5 días) | con seguimiento en ≤4 días contestó 59 % | — |
| Pago pendiente | 34 | **28 %** | 28 % | 70 % · 34 % | 30 % |
| Lo pensará / objeción | ~100 | 3 % | 12–13 % (regresó) | — | — |
| Cotización personal | 181 | 4 % | 6 % | 53 % · 17 % | 17 % |
| Le pedimos medidas | 49 | 1 % | 13 % | (n=3) | 15 % |
| Precio general | **1,927** | 1 % | 4 % | 50 % · 9 % (n=34) | 8 % |
| Solo información | 168 | 0.3 % | 10 % | (n=8) | 11 % |
| Otro | 86 | 2 % | 10 % | 93 % · 11 % | 18 % |
| Ya no le interesa | ~20 | 1 % | regresó 8 % | — | — |

- **1.er intento antes del cierre de la ventana:** el último momento para escribir texto personal (barato y sin
  plantilla); de los callados a las 8 h, solo el 28 % iba a contestar solo antes de las 24 h, y a las 20 h, el 8 %.
  Los seguimientos de 1 a 4 días contestaron 56–72 %; a los 15 días, 11 %.
- **2.º intento el día 2:** la mejor franja de los vendedores (30–100 h: 71–72 %) y, en las paradas de anuncio, cae
  dentro de la ventana gratis en el 86 % (precio general: 57 % del total).
- **3.er intento el día 9, solo en los casos que venden** (pidió fecha, pago, objeción, cotización): ahí está el 7–28 %
  de compra; 37 de las 114 ventas con pausa regresaron después de 2 semanas. En precio general, solo información y
  medidas, el seguimiento tardío de Ángela dio 8–15 % de respuesta y casi ninguna venta: no se agrega.

### 6.2 La hora de cada caso (aprobada el 2-oct; hora local del cliente según su lada, GHL mar–sep)

| Lo que mide | 7–9 h | 9–12 h | 12–15 h | 15–17 h | 17–19 h | 19–21 h | 21–24 h |
|---|---|---|---|---|---|---|---|
| Mensajes del cliente (todos) | 6 % | 22 % | 24 % | 15 % | 13 % | 10 % | 8 % |
| Primer mensaje (llega por el anuncio) | 8 % | 18 % | 19 % | 12 % | 13 % | 13 % | 12 % |
| Comprobante / venta confirmada | 1 % | 25 % | **37 %** | 18 % | 15 % | **3 %** | 0.5 % |
| Regresa solo con las medidas | 7 % | 24 % | 20 % | 15 % | 15 % | 12 % | 5 % |
| Nuestro mensaje contestado en 2 h | 54 % | 57 % | 70 % | 71 % | 74 % | **77–79 %** | 72–74 % |

- **Pago pendiente → 10:00.** El 95 % de los pagos llega de 9 a 19 h (el pico, de 12 a 15 h) y de noche casi nadie
  paga (3 %): en la mañana alcanza a pagar ese mismo día.
- **Faltan medidas, objeción, precio, solo información → de noche (19:00–21:00).** Es cuando el cliente contesta
  más rápido (77–79 % en 2 h, contra 54–57 % en la mañana), ya está en casa para medir o platicarlo, y la cuarta parte
  de los primeros mensajes llega de 19 a 24 h.
- **Cotización y sin punto claro → 18:00–20:00.** Decide después del trabajo; los seguimientos de los vendedores
  contestaron 66–67 % de 13 a 19 h (nunca mandaron de noche, así que no hay contra qué comparar la noche).
- **Pidió fecha → la hora que pidió; si solo dijo el día, 11:00** (sus regresos se juntan de 12 a 15 h: 33 %).
- **Asesor → 2 h después; los siguientes, 10:00** (regresan sobre todo de 9 a 12 h: 35 %).
- **De 7:00 a 9:00 solo como último recurso** (para alcanzar la ventana): es la franja con menos respuesta (54 % en
  2 h; Ángela, 7 %).
- **Quincena / fin de mes:** en GHL no se vendió más en esos días (26 % de las ventas cayó en los días 14–16 y
  29–2, lo mismo que el calendario) y solo 3 clientes en 6 meses la mencionaron. Por eso, cuando el cliente la pide
  va en "Pidió fecha"; una regla general de fechas de pago se revisa con los datos del CRM (§12).

**El Agente IA lo sabe:** la hora del caso y su porqué van en las instrucciones con las que redacta el seguimiento,
y se ven y editan en Agente IA › Seguimientos (Parte 4). Como a veces la ventana cierra antes de la hora del caso y el
intento sale más temprano, el borrador se escribe para que sirva a cualquier hora (sin "hoy", "esta noche" ni "cuando
esté en su casa"): el saludo con la hora ("buenos días / buenas tardes / buenas noches") lo pone el CRM al salir
(encontrado en la vista previa de la Parte 1, 2-oct-2026).

---

## 7. Por dónde sale

### 7.1 Ventana abierta
El Agente IA (el modelo de la etapa del contacto, con el Goal, las FAQs y el chat completo) recibe la ficha y
escribe **un** mensaje con las reglas de §7.3. Sale como del Agente IA (`source: ai_agent`): no pausa al Agente IA, no
marca leído y no cuenta como primera respuesta humana.

### 7.2 Ventana cerrada (plantilla)
1. Sale la plantilla del intento (🚪 o 📄, §6) como del Agente IA (sin pausarlo).
2. El seguimiento queda "esperando respuesta" con su ficha.
3. Cuando el cliente contesta, la respuesta normal del Agente IA lleva en su contexto
   *"Seguimiento: le escribimos por «pendiente»; objetivo: «siguiente paso»"*, así que retoma justo ese punto.
4. Si llegó por anuncio y sigue en su ventana gratis, la plantilla no cuesta.

### 7.3 Cómo escribe el Agente IA el seguimiento (de los que sí funcionaron en GHL)
- **Corto** (1–2 líneas), con saludo según la hora y su nombre.
- **Lo concreto:** la talla, la medida, la cotización o el pedido, y cuándo lo platicaron ("hace un par de días").
- **Pregunta por la decisión o la duda**, no por datos que ya dio: "¿Tuvo oportunidad de valorarla? ¿Qué le pareció?".
- **Trae algo útil** si lo hay: la respuesta a su duda, el video de instalación, cuándo le llegaría.
- **Si tardamos nosotros, disculpa** ("una disculpa por la espera").
- **Nunca**: genérico ("solo paso a dar seguimiento"), volver a pedir la medida si ya se pidió, "último seguimiento",
  ni presión.

### 7.4 Chats que lleva un vendedor (decisión del dueño, 2-oct: automático con aviso)

**Qué es:** cuando un vendedor escribe (desde el CRM o desde el celular), el Agente IA se pausa en ese chat y, de
fábrica, no vuelve hasta que alguien pulsa "Activar". El lector sigue leyendo esos chats, así que **la ficha y la hora
del seguimiento se calculan igual** que en los demás. En GHL el 90 % de los chats con pago pendiente y el 33 % de los
de cotización ya los llevaba un vendedor, y los vendedores solo alcanzaron a seguir 266 de 11,686 paradas.

| Momento | Qué pasa |
|---|---|
| Antes de la hora | El vendedor ve el seguimiento programado en el botón del composer (§8) y puede verlo, cambiar la hora, mandarlo él o cancelarlo |
| El vendedor escribe antes de la hora | Se cancela ese seguimiento; si el chat vuelve a quedar parado, el lector hace una ficha nueva |
| Llega la hora y el vendedor no hizo nada | **Sale solo** (texto o plantilla, como en §7.1–7.2), aunque el Agente IA siga en pausa |
| El cliente contesta al seguimiento | **La conversación sigue con el Agente IA**: la pausa se quita en ese chat y el Agente IA le contesta con el contexto del seguimiento |
| El vendedor vuelve a escribir | El Agente IA se vuelve a pausar, como hoy |

En un chat de vendedor el mensaje no habla como asistente: habla como Diluvium y retoma lo que el vendedor dejó
pendiente. Si el Agente IA está **apagado en el canal**, no hay seguimientos.

**"Pausar agente" puesto a mano** (decisión del dueño, 2-oct): el vendedor pidió a propósito que el Agente IA no entre,
así que ahí el seguimiento **no sale solo: queda como sugerencia** en el botón 🤖 ("Sugerido · 20:00", en amarillo)
y la tarjeta del Embudo se pone **amarilla** (el Agente IA necesita al vendedor) a la hora del intento.

**Si esa hora cae fuera del horario de los vendedores** (propuesta; en GHL escribían de lunes a viernes de 9:00 a
18:00 y los sábados de 8:00 a 13:00; los domingos, casi nada):
1. La sugerencia se le presenta **antes de que se vaya**: en su última hora de trabajo antes del intento (p. ej.
   17:00 para uno de las 20:00, o el sábado a las 12:00 para uno del domingo), con la tarjeta amarilla.
2. En la burbuja tiene, además, **"Que salga solo"**: con un toque, ese intento se vuelve automático (opción B): sale
   a su hora y, si el cliente contesta, la conversación sigue con el Agente IA.
3. Si nadie decide, **no sale y no se pierde**: sigue amarilla hasta el siguiente turno. Si para entonces ya cerró la
   ventana, "Lo mando yo" (WhatsApp Web, sin ventana) o el botón 🤖 con la plantilla.

**Si el cliente pide una hora fuera de 7:00–21:00** ("escríbame a las 10 de la noche"), se usa la más cercana
dentro del horario (21:00 o 7:00).

---

## 8. Qué se ve en el CRM (propuesta)

**El Detalle del contacto ya está lleno: el seguimiento vive en el composer**, en el mismo renglón que ⚡ Mensajes
rápidos, 📄 Plantillas y 📎 Adjuntar (Bandeja y pop-up del Embudo usan el mismo composer).

- **Píldora 🤖 DENTRO de la barra, en el hueco que queda arriba de ⚡ 📄 📎** (decisión del dueño, 2-oct): la caja
  de texto mide dos renglones y los iconos uno, así que arriba de ellos sobra un espacio blanco; la píldora lo rellena
  (unos 20 px de alto y el ancho de los tres iconos), sin cambiar ni el ancho ni el alto de la barra. En el celular,
  donde los iconos van en su propio renglón, va al final de ese renglón. **Solo aparece cuando el chat tiene un seguimiento**;
  dice la hora: `🤖 Seguimiento · 20:00` (programado, azul) · `🤖 Sugerido · 20:00` (pausa puesta a mano, amarillo) ·
  `🤖 Esperando` (salió con plantilla y espera respuesta) · `🤖 Ensayo 20:00` (Parte 1, gris punteado). Sin
  seguimiento, no hay botón (menos datos).
- **Al tocarlo se abre la burbuja** arriba del composer, como la de Mensajes rápidos:
  - qué es: "Faltan medidas · 1.º de 2", por qué ("Se le pidió el ancho y no lo ha mandado") y qué busca;
  - cuándo: la hora de Mazatlán y, si es distinta, la del cliente; por dónde sale (texto del Agente IA o la
    plantilla);
  - botones **Ver mensaje** (el borrador; se actualiza con lo último del chat al salir), **Cambiar hora**, **Lo mando
    yo** (abre WhatsApp Web con el texto ya escrito: gratis y sin ventana de 24 h) y **Cancelar** (con confirmación;
    cancela todo el seguimiento de ese pendiente, no solo el siguiente intento); en una sugerencia, también **Que
    salga solo**.
- **Cuando sale**, la burbuja del mensaje en el chat lleva la marca "Seguimiento". Mientras se manda, la píldora del
  Agente IA dice "enviando seguimiento".
- **No** va una línea en el Detalle ni una tarjeta dentro del hilo (sería repetido).
- **Agente IA › Seguimientos:** la tabla de la §6 (encender/apagar cada caso e intento, horas, objetivo en texto).
- **Dashboard:** una tarjeta: seguimientos enviados · contestaron · avanzaron de etapa · compraron (del periodo).
- **Historial:** los cambios a la tabla de casos quedan en Agente IA › Historial.
- **Embudo:** nada nuevo en la tarjeta, salvo el color de pago pendiente si se aprueba (§12).

---

## 9. Topes y paradas (fijos en el código)

- Se cancela si: el cliente escribe, un vendedor escribe, el contacto llega a la etapa con papel **Venta cerrada**,
  el Agente IA está apagado en el canal, el caso se apagó, o un vendedor lo cancela.
- Máximo **3 intentos** por punto pendiente (2 en los casos que no venden, §6). Después: temperatura **frío**; aviso
  🤖 solo en pago pendiente y asesor sin respuesta.
- **Plantillas de seguimiento al mismo contacto: nunca dos en menos de 7 días.**
- **131049** (tope de marketing): aviso, sin reintento. **131050** (baja): el contacto queda "sin seguimientos"
  (se quita desde el Detalle).
- Solo a contactos que **ya escribieron** alguna vez (nunca a un contacto sin chat).
- **Horario de envío: 7:00–21:00 hora del cliente** (decisión del dueño, 2-oct; estado de su lada → zona horaria;
  sin lada mexicana, Mazatlán), con la hora de cada caso (§6.2), **todos los días, domingo incluido** (decisión del
  dueño, 2-oct: si al seguimiento le toca ese día, sale ese día). Con plantilla, hasta las 19:00.

---

## 10. Costo estimado (con los volúmenes de GHL de ago–sep)

Base: ~2,450 paradas al mes (precio general 1,930 · cotización 180 · solo información 170 · otro 90 · medidas 50 ·
pago 35 · asesor 8). Supuesto: **80 %** no contesta el 1.er intento y **60 %** de los casos que venden no contesta
el 2.º. Más o menos la mitad de los intentos caen en la ventana gratis del anuncio.

| Concepto | Cuenta | Al mes |
|---|---|---|
| Ficha de seguimiento | Sale en la lectura que ya existe (unos tokens más de Luna) | ≈ US$0.5 |
| 1.er intento con texto (~2,350) | Servicio ~MX$0.16, gratis dentro de la ventana del anuncio (~la mitad) + redacción de la IA | ≈ MX$190 + US$10–30 |
| 2.º intento con plantilla (~1,900) | Marketing ~MX$0.73, gratis en la ventana del anuncio (~la mitad) | ≈ MX$700 |
| 3.er intento con plantilla (~200) | Marketing ~MX$0.73 (ya casi nunca en la ventana gratis) | ≈ MX$150 |

Total aproximado: **≈ MX$1,050 en WhatsApp + la IA de §10.1**. Se ajusta con los números reales después de una semana.

### 10.1 Saldo de IA (lo que sale de OpenAI y Anthropic)

Bases: lector = US$0.00037 por lectura, 211–433 lecturas al día (27 y 28-sep); respuesta del Agente IA = US$0.0009
con Luna y US$0.033 con Sonnet (28-sep 18:29 → 29-sep 16:14, Mazatlán); precio de Luna US$0.20 / 1.20 por millón de
tokens (entrada / salida); volúmenes de GHL de ago–sep.

| Qué | ¿Cobra del saldo de IA? | Al día | Al mes |
|---|---|---|---|
| **Ficha** (caso, pendiente, hora, borrador) | Sí, pero va **dentro de la lectura que el lector ya hace**: solo unos tokens más de Luna (las instrucciones se repiten y OpenAI las cobra a 1/10 en caché) | ≈ US$0.07–0.20 | ≈ US$2–6 |
| **1.er intento con texto**, opción propuesta: sale el borrador del lector tal cual (el chat no cambió desde esa lectura; si cambia, el seguimiento se rehace) | No | US$0 | US$0 |
| 1.er intento con texto, si se vuelve a redactar al salir con Luna | Sí | ≈ US$0.07 | ≈ US$2 |
| 1.er intento con texto, si se vuelve a redactar con el modelo de la etapa (Sonnet en Interesado, Cerca de compra y Compra) | Sí | ≈ US$2–2.5 | ≈ US$65–80 |
| **2.º y 3.er intento** (plantilla) | No (solo el cobro de Meta) | US$0 | US$0 |
| **Conversaciones que revive** (el cliente contesta y el Agente IA sigue) | Sí: es el costo normal de un cliente que escribe | ≈ US$0.9–1.8 | ≈ US$25–55 |

La última fila sale de suponer que contesta entre el 15 y el 30 % de los ~2,350 primeros intentos (350–700 chats al mes)
con unas 3 respuestas del Agente IA cada uno, casi todas con Sonnet. Es lo que cuesta atender a un cliente que regresa:
el objetivo del seguimiento. En el ensayo (Parte 1) se mide el costo real de la ficha, porque queda anotado en cada
lectura.

---

## 11. Plan de construcción (por partes; cada una por staging y "OK MAIN")

| Parte | Qué | Migración |
|---|---|---|
| **0 ✅** | **En producción (main d38f387, 2-oct):** plantillas al día solas ("Ver estado"; chequeo al abrir Plantillas y el worker cada 10 min mientras haya alguna en revisión); `{{1}}` = primer nombre del contacto en 📄, 🕒 y el primer mensaje del Embudo. | No |
| **1** | Tabla `follow_ups` + la ficha en el lector + cálculo de la hora (§6, horario por lada) + la píldora 🤖 y su burbuja en la caja para escribir + el barrido que anota cuándo "habría salido" cada intento. **Modo ensayo: no manda nada**, para que el dueño vea en chats reales si las fichas y los tiempos tienen sentido. Solo WhatsApp (Instagram, después). | 0056 (la 0055 es Instagram) |
| **2 ✅** | Envío con la ventana abierta + paradas + 2.º y 3.er intento + frío y aviso (§15, 6-oct-2026). | 0059 |
| **3 ✅** | Ventana cerrada: plantilla como del Agente IA (sin pausarlo), retomar con contexto cuando conteste, tope de 7 días, 131049/131050 (§15). | (misma) |
| **4** | Agente IA › Seguimientos (editar la tabla), chats de vendedor (sugerido + WhatsApp Web), tarjeta del Dashboard, mapa y capturas. | No |

Pruebas: lógica pura (casos, horas, zona por lada, topes) con Vitest; integración con Postgres real (ficha → programa
→ cancela/sale); staging con webhooks firmados. La prueba real del envío solo se puede hacer en producción, con un
contacto de prueba del dueño.

---

## 12. Decisiones del dueño

**Aprobado (2-oct-2026):**
- La tabla de casos (§6, los 10 casos con sus intentos y objetivos) y la hora de cada caso (§6.2).
- Horario de 7:00 a 21:00, hora del cliente, **todos los días** (domingo incluido si el seguimiento cae ese día).
- Chats que lleva un vendedor: **automático con aviso**; si el cliente contesta, **la conversación sigue con el
  Agente IA** (§7.4).
- Sin plantilla de "buenas noches": una plantilla de noche que no es respuesta del Agente IA es rara; las plantillas
  salen hasta las 19:00.
- Sin reactivación tardía de 15 días como Ángela: el seguimiento sale del contexto del chat.

- El botón 🤖 va arriba de ⚡ 📄 📎 (§8). "Cancelar" cancela todo el seguimiento de ese pendiente; si el chat cambia y
  vuelve a quedarse parado, se arma uno nuevo.
- "Pausar agente" puesto a mano: el seguimiento queda como sugerencia (§7.4).

- Fuera del horario de los vendedores (§7.4): la sugerencia se presenta antes de que se vaya, con "Que salga solo";
  si nadie decide, espera al siguiente turno. Horario de los vendedores de fábrica: lunes a viernes 9:00–18:00 y
  sábado 9:00–13:00, hora de Mazatlán (de los datos de GHL; editable en Agente IA › Seguimientos).
- El modo ensayo lo ven todos los roles, vendedores incluidos ("para eso es").

**Abiertas:**
1. **Pago pendiente, aviso al vendedor:** cuándo (propuesta: si no contesta el 2.º intento) y cómo (la tarjeta
   amarilla de hoy o un color propio en el Embudo). Por ver.
2. ~~Plantillas de cada intento~~ y ~~plantillas propias por caso~~: **resueltas el 3-oct-2026** (6 plantillas
   `seg_*`, §3).
4. **Fechas de pago (quincena, fin de mes):** cuando el cliente la pide, va en "Pidió fecha". Una regla general se
   revisa con los datos del CRM, una vez que haya seguimientos funcionando.
5. **Quién redacta el texto al salir (§10.1):** el borrador del lector tal cual (sin gasto extra; propuesta) o una
   llamada nueva al salir.

---

## 13. Detalle técnico (para Code)

**Datos (migración 0056, construida en la Parte 1):** `follow_ups` (`lib/db/schema/followups.ts`) — una fila por
pendiente: caso, status (`programado` → `esperando` → `terminado`; o `contestado`, `cancelado` con `cancel_reason`, y
`no_seguir`), `ensayo`, intento y total_intentos, la ficha (pendiente, siguiente_paso, motivo, borrador, fecha_pedida,
hora_pedida), time_zone del cliente, due_at, door (`texto` | `plantilla`), template_name, modo (`automatico` |
`sugerido`), presentar_at, auto_aprobado ("Que salga solo"), due_set_by (`sistema` | `vendedor`), intentos (jsonb: cada
intento que salió o "habría salido"), based_on_message_at (hasta dónde leyó el lector). Índice único parcial: un solo
`programado`/`esperando` por conversación. Para la Parte 2+: tabla de casos editable (`follow_up_rules` o
`ai_config.jsonb`) y `contacts.sin_seguimientos` (bool) para las bajas.

**Código:**
- `lib/ai/runtime/lector-core.ts`: el esquema de `actualizar_contacto` (`lectorSchemaFor`) suma `seguimiento`
  (opcional), y las instrucciones del lector explican los casos y las reglas de §7.3. Validación pura nueva (caso
  válido, textos acotados, fecha futura < 60 días).
- `lib/followups/rules.ts` (puro): tabla de §6, prioridad de casos, cruce con datos duros (§5) y cálculo de `due_at`
  (antes del cierre / día 2 / día 9, hora de cada caso, horario 7–21, domingo, plantillas hasta las 19:00 y 7 días
  entre plantillas).
- `lib/ai/runtime/lector.ts`: al aplicar la lectura, si el último mensaje es nuestro, guarda o reemplaza la ficha.
- `lib/followups/timezone.ts` (puro): estado de la lada (`lib/phone-lada-data.ts`) → zona horaria (Tijuana, Hermosillo,
  Mazatlán, Chihuahua/Ciudad Juárez, CDMX, Cancún).
- Worker: `startFollowUpRuntime` con el patrón de `startLectorRuntime` (barrido cada 60 s, candado por chat).
- `lib/messaging/send.ts`: `sendTemplateMessage` acepta `source` (`crm` | `ai_agent`) y `sentByUserId` nulo; con
  `ai_agent` no pasa por `pauseAgentForManualSend`.
- `lib/ai/runtime/actions.ts` (`crmContextFor`): agrega la línea del seguimiento esperando respuesta.
- `lib/ai/runtime/policy.ts` (`NoticeKind`): tipo nuevo `seguimiento`.
- Asesor sin respuesta: si "pedir asesor" pausó al Agente IA en ese chat, la pausa la puso el Agente IA (no un
  vendedor): el seguimiento sí sale; revisar la regla al construir la Parte 2.
- UI: botón 🤖 y su burbuja en `composer.tsx` (después de `AttachMenu`, mismo patrón que `SnippetPicker` /
  `TemplatePicker`; en móvil va en el renglón de ⚡ 📄 📎 🕒); marca "Seguimiento" en la burbuja del mensaje enviado;
  "Lo mando yo" reutiliza el enlace de WhatsApp Web del primer mensaje del Embudo; subpestaña en Agente IA; tarjeta del
  Dashboard.
- Chats de vendedor: al contestar el cliente un seguimiento que salió con el Agente IA en pausa, se quita la pausa
  (`lib/ai/runtime/pause.ts`) antes de encolar la respuesta; la pausa a mano ("pausar") y la automática ("pausa_auto")
  hoy solo se distinguen en el historial: si se decide tratarlas distinto (§12), hace falta guardarlo en la
  conversación.

---

## 14. Revisión del ensayo y arreglos al lector (3-oct-2026)

Se leyeron en producción (solo lectura, OK del dueño) las 102 fichas del 3-oct, chat por chat. Informe con los
números en `~/Documents/Diluvium CRM/reportes/seguimientos-ensayo/informe-3-oct.md` (fuera del repo). Lo que salió:
- **Horas: ~95 % bien** (la del caso en la zona del cliente, o 1 h antes de que cierre su ventana).
- **Borradores: lo más grave.** 47 de 95 volvían a preguntar «¿tiene problemas de inundaciones?» (el workflow
  «Información» ya lo pregunta) y 58 repetían «$5,500 con envío gratis». Causas: el lector tomaba la última pregunta sin
  contestar como «lo pendiente», las instrucciones pedían «lo concreto» (en un chat de precio, solo el precio) y no
  recibía qué busca cada caso.
- 2 chats con un seguimiento que **el vendedor ya había hecho**; 4 «pidió fecha» no detectados («mañana mido»); 1 cliente
  que compró por Mercado Libre; extranjeros mal clasificados; «Precio» y «Solo información» mezclados.

Decisiones del dueño y lo construido (rama `feat/seguimientos-lector`, migración **0057**):
1. **El seguimiento que manda un vendedor cuenta como intento** (`lib/followups/vendor-attempts.ts`): después del último
   mensaje del cliente, cada tanda de la empresa que llega tras 8 h de silencio y trae un mensaje de vendedor (CRM o
   celular) es un intento ya hecho; el CRM programa el siguiente. Si ya hizo todos, solo se espera respuesta.
2. **Compra cancela al instante** (`lib/followups/sale.ts`, en la misma transacción del cambio de etapa).
3. **Pidió fecha** con frases sin hora (tabla de §6); si solo dijo el día, sale a la hora del asunto pendiente
   (`caso_de_fondo`).
4. **Reglas del borrador** (aprobadas): una sola pregunta; nunca una pregunta ya hecha (con las mismas u otras palabras),
   haya contestado o no; nunca el precio ni la información ya dados; primero contestar la duda que dejó el cliente;
   guía de qué busca cada caso. En precio e información: el ancho de su entrada si nunca se pidió, o si le quedó alguna
   duda (las dos valen, según cómo quedó el chat). **El CRM revisa el borrador** (`borrador-check.ts`); si falla, el
   lector lo rehace UNA vez (≈ US$0.0004); si vuelve a fallar, el intento no sale con texto.
5. **Precio = el cliente preguntó el precio; Solo información = solo mandó el texto del anuncio.**
6. **Extranjero = no seguir**, aunque tenga a alguien en México, si en el chat ya se le dijo que no se envía fuera.
7. **Plantilla de cada intento según el chat:** el lector elige entre las aprobadas (`plantilla_2`, `plantilla_3`) la
   que mejor encaje y nunca una que repita una pregunta ya hecha; el CRM confirma que esté aprobada y que no sea la del
   intento anterior; si nada encaja, el saludo. **Solo información** usa `seg_info_duda` (plantilla nueva, texto aprobado
   por el dueño el 3-oct-2026 y dada de alta en Meta ese día); mientras Meta no la aprueba, `seg_precio`. `seg_informacion`
   vuelve a preguntar lo del agua: solo sale si el lector la elige porque nunca se preguntó.
8. Los 7 días entre plantillas cuentan **todas** las que le llegaron al contacto (también las de los vendedores).
9. Una ficha «no seguir» se actualiza en su lugar en cada relectura (antes dejaba filas repetidas).

---

## 15. Envío real: Partes 2 y 3 (6-oct-2026)

El dueño dio su OK escrito para pasar a Real; se construyó todo lo aprobado (rama `feat/seguimientos-envio`,
migración **0059**; la 0058 es la de los costos de WhatsApp de otra rama, que debe entrar antes a `main`).
- **Interruptor** en Agente IA › Opciones › **Seguimientos del Agente IA**: Ensayo (fábrica) / Real
  (`ai_config.seguimientos_real`; el cambio queda en el Historial de Opciones). Lo programado obedece el interruptor al
  salir; la píldora 🤖 dice «Ensayo» o «Seguimiento».
- **Cómo sale** (`lib/followups/dispatch.ts`, barrido de `store.ts`): como mensaje del **Agente IA** (`source: ai_agent`):
  no pausa al Agente IA, no marca leído, no cuenta como respuesta humana ni para el tope de respuestas. Texto = el
  borrador con «Hola <nombre>, buenos días / buenas tardes / buenas noches.» según la hora del cliente; sin borrador, ese
  intento va por plantilla. Plantilla = la elegida (§14) ya APROBADA, con `{{1}}` = cuándo escribió (o el nombre). La fila
  se aparta antes de mandar (dos barridos nunca mandan el mismo intento) y su id es la clave de idempotencia.
- **Último chequeo al salir:** el chat no cambió, Compra, canal encendido, sin_seguimientos, hora del cliente 7:00–21:00
  (plantilla hasta 19:00) y 7 días entre plantillas (cualquiera que le llegó); si no, se recorre a la siguiente hora válida.
- **El lector no rehace la ficha** por nuestro mensaje: los mensajes llevan `metadata.seguimiento` y, si es lo único
  nuevo, el lector ni llama al modelo.
- **Contesta el cliente:** si el Agente IA estaba en pausa automática (vendedor contestó, tope o asesor) ANTES del
  seguimiento, se quita la pausa (Historial: «El cliente contestó un seguimiento: el agente volvió»), y el Agente IA
  recibe la línea «[SEGUIMIENTO] Le escribimos por… Lo que buscamos…» (`lib/followups/reply.ts`). La pausa a mano solo se
  quita con «Que salga solo».
- **Sugerencia** (pausa a mano): no sale sola; a su hora de presentarse deja un aviso 🤖 (tarjeta amarilla).
- **Avisos al vendedor** (tarjeta amarilla, tipo `seguimiento`): pago pendiente 24 h después del 2.º intento sin
  respuesta; asesor sin respuesta al terminar. **Frío** al terminar la espera tras el último intento (solo si salió de verdad).
- **Errores:** lo que falla queda en el intento («no salió · motivo» en la burbuja 🤖) y en la burbuja del mensaje; nunca
  se reintenta solo. **131049** (tope de promociones de Meta) queda anotado; **131050** (baja) marca el contacto
  `sin_seguimientos` y cancela lo pendiente (también si vino de una plantilla de un vendedor).
- **Marca en el chat:** «🤖 Seguimiento» arriba del mensaje.
- **Sin nombre (6-oct-2026, decisión del dueño):** el nombre del perfil de WhatsApp o Instagram muchas veces no es el del
  cliente («Doble», «Laurenzt»): el texto empieza «Hola, buenos días / buenas tardes / buenas noches, le escribo de parte del
  equipo de Diluvium.» y ningún seguimiento usa el nombre (tampoco en `{{1}}` de una plantilla).
- **7 días entre plantillas (arreglo del 6-oct-2026):** en Real solo cuentan las plantillas que de verdad le llegaron al
  contacto (las del Agente IA y las de los vendedores); las que solo «habrían salido» en el ensayo ya no frenan.
- **Tarjeta del Dashboard (Parte 4, 6-oct-2026):** «Seguimientos del Agente IA» al final del Dashboard, con el periodo de
  arriba: mensajes que salieron (y no entregados), chats, contestaron (72 h), avanzaron de etapa y compraron, por caso
  (`lib/dashboard/seguimientos.ts`, `follow-up-card.tsx`). Cada envío guarda `metadata.seguimiento.etapa` para medir quién avanzó.
- **Píldora 🤖 (6-oct-2026):** mide lo mismo que ⚡ 📄 📎 y dice solo cuándo sale; el tipo lo dice el color.
- Pruebas: `lib/followups/envio.int.test.ts` (proveedor falso: texto una sola vez, plantilla, 20:00 → día siguiente,
  ensayo, sugerencia y aviso, opción B, 131050, frío) y `lector.int.test.ts` (el lector no relee por un seguimiento).
- **Píldora con caritas (6-oct-2026, decisión del dueño):** imágenes propias en `public/emoji/` (no existe emoji de robot con
  esos ojos): normal = programado; **dormido** = suspendido (pausa puesta a mano; sustituye a «Sugerido»); **ojos en X** =
  cancelado (gris) o se dio de baja (rojo). Contestó o compró = sin píldora.
- **Cancelar = el chat entero (6-oct-2026):** `conversations.seguimientos_off_at/_by_user_id` (migración **0061**). Ni el
  Agente IA ni el lector arman seguimientos en ese chat hasta **Reactivar seguimientos** (vendedor o admin), que reabre el
  último cancelado si el chat no cambió (`reopenCancelledFollowUp`).
- **Se dio de baja (131050):** nada en el Detalle; la píldora se pone roja y su aviso se abre solo una vez por computadora,
  con «Volver a darle seguimiento» (`quitarSinSeguimientos`).
- **Pendiente:** Agente IA › Seguimientos (editar la tabla) y la tarjeta del Dashboard (Parte 4).

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
- [G5] Historial completo de GHL exportado por API (108,864 mensajes, 21-mar → 1-oct-2026) y contactos con etiquetas
  (19-sep), analizados el 1 y 2-oct-2026. Datos de clientes: **fuera del repo** (carpeta de notas del dueño); aquí solo
  van cifras agregadas.
- [G6] Ask AI de GHL (2-oct-2026): configuración actual de Ángela y Ángela 2.0, embudo y etiquetas.
- [C1] Lector en segundo plano: `lib/ai/runtime/lector-core.ts`, `lector.ts`, `lector-worker.ts` (main 8426d80).
- Investigación previa (plantillas, edición, coexistencia): `docs/investigacion/plantillas-zernio.md`.
