> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Links de pago: el Agente IA manda el link de MercadoPago (30-oct-2026, migraciones 0076 y 0077)

Pedido del dueño: con los links de MercadoPago (no vencen), el Agente IA ya puede mandar solo el link que corresponde a lo
que eligió el cliente, en vez de decir «un asesor le envía el link». Pantalla: mapa 3.6 › 98–106.

**Lo que había (chats de producción, 27-sep al 29-oct).** El Agente IA le dijo a 16 clientes «un asesor le envía el link»;
8 lo recibieron (esperas de 1 min, 24 min, 1 h 32, 2 h 21, 15 h 51, 16 h 48, 22 h 53 y 1 día 16 h) y 8 nunca. En los 12
chats con link, 8 fueron el de 1 compuerta ($5,500) y 1 el de 2 compuertas ($11,000). Un seguimiento preguntó «¿pudo
recibir el enlace?» a quien nunca se lo mandaron, y a otro MercadoPago le rechazó el pago «por motivos de seguridad».

### Dónde vive (decisión: apartado propio, ni Goal ni FAQ)

- **Agente IA › Links de pago** (tabla `links_pago`): nombre, monto, «Cobra» (el total o la mitad: anticipo o liquidación
  de una compuerta a la medida), «Pago» (de contado o hasta N MSI) y el link. La editan todos los roles, como el resto de
  la pestaña; cada guardado queda en el Historial («Cambió los links de pago», con la lista antes y después).
- **No en el Goal ni en las FAQs:** el modelo tendría que copiar el link letra por letra (una letra mal y no sirve), nada
  revisaría que cobre lo acordado y cada cambio de link sería un cambio del Goal (22:00 y su costo).
- **Precio especial = solo vendedor** (regla del dueño, 30-oct): 2 compuertas en $10,400, 3 en $15,000 y los de Los Mochis
  ($5,000 / $4,500) NO se cargan aquí. Si un vendedor dio ese precio, su monto manda (ver candados) y el Agente IA no
  manda uno de lista.

### Cómo sale

- Herramienta `enviar_link_pago { opcion }` (`lib/ai/runtime/tools.ts`): una opción por link, con clave sacada del nombre
  («1_compuerta_estandar») y, en la descripción, qué cobra cada una. El modelo nunca escribe el link.
- El CRM manda el link como **un mensaje más del Agente IA, después de su texto** (`run.ts`; entra al plan guardado, así
  que un reintento no lo duplica), con el texto de `mensajeLink`:
  «Aquí le paso el link para pagar $5,500 con tarjeta por MercadoPago ✅ / link / Puede pagar con tarjeta de crédito o
  débito, y con crédito elegir hasta 6 meses sin intereses. Cuando realice el pago, por favor mándeme por aquí su
  comprobante.» (de contado: «Es un pago de contado con tarjeta de crédito o débito.»). Los datos de envío se piden con el
  comprobante, igual que con la transferencia (COMPROBANTES DE PAGO del Goal).
- El contacto pasa a **Cerca de compra** (como los datos bancarios; solo hacia adelante, mismas reglas de etapa).
- Como los datos bancarios, el link **provoca el traspaso** Luna → Sonnet (`impliedStage`: lleva a Cerca de compra) y el
  link del Modelo 1 se conserva si el Modelo 2 no pidió uno. Un link cuenta como respuesta para la red contra el silencio.
- El lector: `pago_pendiente` ahora dice «ya recibió los datos bancarios o el link de pago…».

### Candados en el código (`lib/agente-ia/links-pago.ts`, `planLink` en `actions.ts`)

1. **Lada fuera de México: nunca** (regla estricta del dueño, 30-oct). Misma regla que los seguimientos
   (`foreignLadaLabel`): Perú, Ecuador, Chile, España… nunca; **+1 (Estados Unidos, Canadá) sí**; sin teléfono
   (Instagram) sí. La herramienta ni se ofrece en ese chat y, si el modelo la pidiera igual, no sale nada (ni la frase del
   asesor ni aviso: tampoco por medio de un asesor).
2. **Debe cobrar el total acordado** (o la mitad en anticipo/liquidación). Total: el que puso un **vendedor** manda; si
   no, el que fija esta misma respuesta o el guardado; sin ninguno, uno que la empresa ya dijo en el chat. Si no cuadra:
   sale «En un momento un asesor le comparte el link de pago.» y el vendedor recibe el aviso «El cliente pide hablar con
   una persona: Mándale tú el link de pago: el Agente IA quiso mandar «…» ($…), pero el total acordado es $…».
3. **Máximo 3 links del Agente IA por chat** (si lo vuelve a pedir, se le reenvía). Con 3, la herramienta ya no se
   ofrece; si la pidiera, la frase del asesor y el aviso.

### Goal (borrador; se aplica con «Programar para las 22:00» el día que el código esté en producción)

Primero el código en producción y después el Goal (si no, el Goal hablaría de una acción que todavía no existe). Sobre la
versión de producción del 30-oct (igual a `angela-goal.md`); si cambió, aplicar los mismos tres cambios sobre la vigente.

1. CIERRE DE VENTA — reemplaza «Si solicita un enlace para pagar con tarjeta, dile que un asesor se lo envía en un momento
   y avisa al vendedor con aviso_vendedor motivo cliente_pide_humano. Sigue atendiendo sus demás dudas.» por:

   > Si elige pagar con tarjeta o pide el link de pago, con el total ya fijado, activa la acción Link de pago
   > (enviar_link_pago) con la opción de lo que eligió: el CRM le manda el link después de tu texto, así que no lo
   > escribas tú; basta una frase corta como «Con gusto, aquí le paso el link.». En la compuerta hecha a la medida manda
   > el anticipo (la mitad), salvo que pida pagar todo; la liquidación, cuando le toque el pago final. Si vuelve a pedir
   > el link, vuelve a activarla. Si no hay una opción para lo que eligió (mini compuertas, tapones, repuestos, 4 o más
   > compuertas, una estándar junto con una hecha a la medida, o un precio especial que le dio un asesor), dile que un
   > asesor se lo envía en un momento y avisa al vendedor con aviso_vendedor motivo cliente_pide_humano. Sigue atendiendo
   > sus demás dudas.
   >
   > A un cliente con lada de fuera de México (te lo dice el contexto del CRM) nunca le prometas un link de pago: si
   > quiere pagar con tarjeta, dile que un asesor le confirma cómo hacerlo y avisa al vendedor.
   >
   > Si dice que MercadoPago le rechazó el pago, dile que puede intentar con otra tarjeta o pagar por transferencia o
   > depósito, y avisa al vendedor con aviso_vendedor motivo cliente_pide_humano.

2. COMPROBANTE DE PAGO — «Después de activar la acción "Datos bancarios", continúa…» → «Después de activar la acción
   "Datos bancarios" o "Link de pago", continúa…».
3. PASAR A HUMANO — «(enlace de pago con tarjeta, reclamos o devoluciones…» → «(link de pago sin opción en Link de pago,
   pago rechazado por MercadoPago, reclamos o devoluciones…».

### Migración 0076 (la 0075 es de Envia)

`links_pago` entra como **0076**: la 0075 (`guias_envia`) ya está en staging en su rama. En main el journal salta de 0074 a
0076 (permitido, como la 0030). Si Envia llega a main DESPUÉS de esta rama, su `when` es menor que el de la 0076 y drizzle
la saltaría: el candado `db:check` detiene ese despliegue (sin caída) y hay que renumerarla (0077, `when` nuevo; ver
`docs/migraciones.md`).

### 2.ª parte, el mismo día (migración 0077): dos mensajes, «Solo vendedor», el ⚡ y el cliente de prueba

Pedido del dueño al verlo en staging (mapa 3.6 › 98–109 y 3.2.2 › 108–113):

- **Dos mensajes, editables** (`links_pago_textos`, una fila por organización; null = el de fábrica): primero el del
  link y, **aparte**, el de los datos de envío («Una vez realizado el pago, nos apoya con sus datos de envío: …»).
  Primero el pago y después los datos: da confianza (así lo hacen los vendedores). Variables del mensaje 1:
  `{{monto}}`, `{{link}}` (obligatoria) y `{{forma_de_pago}}` (meses sin intereses o de contado); el 2 sin variables
  y vacío = no sale. Valen para el Agente IA y para el ⚡. Se editan en Agente IA › Links de pago, con «Así le llega
  al cliente» y «Volver al de fábrica»; el cambio queda en el Historial.
- **El último candado del Agente IA** (`sendAgentText`) toma un renglón de una sola palabra («Dirección»,
  «Teléfono») por nota interna del modelo («Winvalid», 12-oct). Los mensajes de un link los escribió el dueño: pasan
  si son, tal cual, uno de los mensajes de un link de la lista (`esMensajeDeLink`; solo se consulta cuando el candado
  ya marcó algo). Todo lo demás del modelo sigue con el candado.
- **«Solo vendedor»** (`links_pago.solo_vendedor`): los de precio especial (2 × $10,400, 3 × $15,000, Los Mochis) se
  guardan en la misma lista para tenerlos a la mano, pero el Agente IA nunca los ve (ni la herramienta ni `planLink`).
- **⚡ con dos pestañas: Mensajes rápidos · Links de pago** (decisión del dueño entre ⚡, 📎 o solo «/»): sin ícono
  nuevo. Al elegir un link se ven los dos mensajes y «Mandar» los envía en orden como mensajes del vendedor
  (`sendLinkPago`; pausan al Agente IA como cualquier mensaje manual) y el contacto pasa a Cerca de compra, como
  `/banco`. En el «/» aparecen con «/link», «/pago» o el nombre del link («Link de pago … ver y mandar»): abren la
  pestaña con ese link elegido (Enter si solo hay uno).
- **Lada extranjera, también para el vendedor:** la pestaña sale apagada con el motivo y el candado está en TODO texto
  que sale (`sendTextMessage` y `sendAgentText`, `linkPagoBloqueado`): un link de la lista nunca sale a un número de
  fuera de México, aunque se pegue a mano (+1 sí; otros links, sí).
- **Cliente de prueba en staging** (`lib/messaging/simulador.ts`, `docs/staging.md` › Cliente de prueba): contacto
  fijo con la ventana siempre abierta (nunca plantilla) y una caja para escribir como el cliente; nada sale a WhatsApp.

**Mensaje 1 de fábrica = como el de los vendedores** (dueño, 30-oct, al verlo en staging): «Adjunto link de pago ✅» y
el link en el renglón de abajo, sin monto ni explicación: corto, ordenado y sin presionar. El monto lo dice la tarjeta
que WhatsApp arma debajo con la página de MercadoPago («Paga $3,000 a Diluvium», el producto y «Abrir link de pago»).
Esa tarjeta sale porque el CRM manda los textos por Zernio con `linkPreview: true` (lo que Zernio hace de fábrica; desde
el 30-oct queda explícito en `lib/messaging/zernio.ts`) y se arma con el PRIMER link del mensaje. La dibuja WhatsApp: si
al mandar no alcanza a leer la página de MercadoPago, el link llega igual (azul, se puede abrir) pero sin tarjeta, y
el diseño cambia un poco entre Android, iPhone y WhatsApp Web. Las variables `{{monto}}` y `{{forma_de_pago}}` siguen
disponibles si se quiere volver a escribir el monto.

**Goal, ajuste por los dos mensajes** (se suma al borrador de abajo): en COMPROBANTES DE PAGO › Pago completo, después
de «…pide los datos de envío:», agregar «Si el cliente ya mandó sus datos de envío (se los pidió el mensaje del link de
pago), no se los vuelvas a pedir: solo agradece y di que un asesor confirma el pago en un momento.». Y en el cambio 1,
«el CRM le manda el link después de tu texto» → «el CRM le manda el link y, aparte, el mensaje de los datos de envío
después de tu texto».

### Pruebas

`lib/agente-ia/links-pago.test.ts` (claves, monto, ladas, los dos mensajes y sus variables, «Solo vendedor», validación,
herramienta y traspaso), `lib/actions/links-pago-chat.int.test.ts` (⚡: dos mensajes en orden, Cerca de compra, Perú
nunca ni pegado a mano, +1 sí), `lib/messaging/simulador*.test.ts` (cliente de prueba),
`lib/agente-ia/links-pago.int.test.ts` (guardar e Historial; se ofrece a México, +1 e Instagram, nunca a Perú; total,
precio del vendedor, mitad, lada, máximo por chat) y `run.int.test.ts` («link de pago: sale DESPUÉS del texto…»).
