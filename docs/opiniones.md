# Opiniones después de la compra

> Diseño y estado de la pestaña **Seguimientos** del menú (subpestañas **Opinión** y, desde el 27-oct-2026, **Amazon y
> Mercado Libre**, § 7) y del formulario público
> `/opinion/<token>`. Decisiones del dueño del 7-oct-2026. Lo que se ve en pantalla está en `docs/mapa-crm.md` §3.11.
> No confundir con Agente IA › Seguimientos (`docs/seguimientos.md`): eso es para chats parados **antes** de comprar.

## 1. Para qué

Hoy, cuando un contacto llega a **Compra**, los seguimientos del Agente IA se cancelan (`no_seguir`, es postventa) y
no pasa nada más. Este es el siguiente paso: pedirle su opinión con un formulario propio del CRM. Lo que se busca,
en orden de dinero:

1. **Recomendaciones de vecinos.** Cuando se inunda una calle, se inunda pareja. Cada cliente tiene un **código de
   recomendación** que va en el mensaje de «Compartir con un vecino».
2. **Fotos y videos reales** para los anuncios de Meta. Se mandan por WhatsApp y caen en el chat del CRM.
3. **Reseñas en Google**: botón al final, **para todos** (Google no permite pedirla solo a los contentos).
4. **Atrapar problemas a tiempo** (pocas estrellas o «se metió agua») antes de que sean una mala reseña.

## 2. Decisiones del dueño (7-oct-2026)

- Formulario **propio del CRM**, no Google Forms: no se suman servicios de terceros, la respuesta cae directo en el
  contacto, y Google Forms pide iniciar sesión para subir archivos.
- Las 4 preguntas: estrellas · «¿Qué le diría a alguien que está pensando comprarla?» · ¿ya le tocó una lluvia? ·
  ¿podemos compartir su opinión? (con su nombre / sin su nombre / no). Foto y video por WhatsApp, no en la página.
- **Momento 1:** 7 días después de pagar el total, plantilla con 3 botones de respuesta rápida: Me quedó bien ·
  Tuve un problema · Aún no la instalo. Tocar un botón abre la ventana de 24 h; con «Me quedó bien», su enlace sale
  como texto normal.
- **Momento 2 (después):** la primera lluvia fuerte en su ciudad (≥ 25 mm en 24 h, `lib/clima/`). Texto provisional
  del dueño: «¿La compuerta resistió la presión del agua?»; va en el cuerpo (el botón admite 25 letras) con los
  botones Sí, resistió · Se metió agua. Depende de que la cinta del clima llegue a main.
- **Solo compradores nuevos**, desde el día que se prenda (no los de esta temporada ni los de GHL).
- El **código de recomendación** se canjeará en la página web; el premio se define después.
- Lo de dentro del CRM: pestaña **nueva** del menú, «Seguimientos», entre Automatización y Configuración, con la
  subpestaña «Opinión». Agente IA › Seguimientos se queda igual.
- Página de prueba con la dirección de Railway (`…up.railway.app/opinion/<token>`). Un subdominio de la página web
  se verá después.
- Google Maps: `https://maps.app.goo.gl/cnujYXX1fUYcbi2z7` (el perfil de Diluvium en Los Mochis, confirmado por el dueño
  el 8-oct). Se guarda en Seguimientos › Opinión › Enlace de Google, no en el código.

## 3. Plantilla del Momento 1 (mandada a revisión el 7-oct-2026)

| | |
|---|---|
| Nombre | `opinion_compuerta` (id de Meta 1348178823876115) |
| Idioma · categoría | es_MX · UTILITY (pedida; Meta puede aprobarla como MARKETING) |
| Texto | Hola, le escribo de parte del equipo de Diluvium por la compuerta que adquirió con nosotros {{1}}. ¿Qué le pareció nuestra compuerta anti-inundaciones? Nos ayuda mucho saber cómo le fue. |
| {{1}} | La fecha en que pagó el total, con «el» (ejemplo: «el 30 de septiembre») |
| Botones | Me quedó bien · Tuve un problema · Aún no la instalo |

- El texto menciona **la compra concreta** porque Meta solo acepta una petición de opinión como Utilidad si es de un
  pedido o interacción específicos. Si decide que es Marketing, la aprueba como Marketing (desde abril de 2025):
  cuesta más y aplica el tope por persona (131049) y las bajas (131050). La categoría de una plantilla aprobada ya no
  se cambia (se puede pedir revisión 60 días).
- **Editar, no borrar.** Una aprobada se edita (texto y botones) 1 vez por 24 h y 10 por 30 días; nombre, idioma y
  categoría no. Borrarla bloquea el nombre 30 días.
- El formulario de Plantillas del CRM solo sube el cuerpo: esta se subió por la API de Zernio (`POST
  /v1/whatsapp/templates`, tipos en minúsculas: `body`, `buttons`, `quick_reply`). «Editar» del CRM respeta los
  botones (solo cambia el cuerpo).
- Antes del envío real hay que comprobar en staging que tocar un botón llegue por Zernio como mensaje del cliente.

## 4. Lo que está hecho (rebanada 1, rama `feature/opiniones`)

- **Tablas** (migración 0064): `opiniones` (un enlace y su respuesta) y `opiniones_config` (enlace de Google por
  organización). Modelo en `CLAUDE.md` §5.
- **Formulario público** `app/opinion/[token]/`: sin sesión, sin menú y sin datos del cliente; solo el logo y las 4
  preguntas. Vista previa del enlace en WhatsApp (título, descripción y logo); `noindex`.
- **Respuesta** por `app/api/opinion/route.ts` (endpoint público, como pide la regla de API routes): valida con el
  mismo esquema que la página (`lib/opiniones/respuestas.ts`), límite de 20 por IP cada 10 min, cuerpo de máximo 8 KB.
- **Seguimientos › Opinión** (`app/(app)/seguimientos/`): lista, **Crear enlace de prueba**, **Enlace de Google**,
  copiar o abrir un enlace sin contestar y borrar los de prueba. ACL `opinion` para todos los roles.

### Reglas del enlace

- Token de 128 bits al azar (`lib/opiniones/codigo.ts`). Se guarda tal cual, no su hash: va en un mensaje de WhatsApp
  que de todos modos queda en el historial del chat, y así se puede volver a copiar.
- **Una sola respuesta**: el `UPDATE … where answered_at is null` evita que dos envíos a la vez se pisen. Si lo abre
  otra vez, ve «Ya recibimos su opinión. Gracias.» con los mismos botones finales.
- Vence a los **60 días** (`VIGENCIA_DIAS`).
- Sin permiso «con mi nombre» no se guardan nombre ni ciudad. Se guarda el texto exacto del permiso que aceptó
  (`permiso_texto`) como respaldo del consentimiento.
- Los botones finales usan el WhatsApp activo de la organización (el real antes que uno de prueba; nunca uno
  archivado). Sin canal, no salen «Mandarla por WhatsApp» ni «Compartir con un vecino».

## 5. Lo que falta (cada rebanada con su OK)

1. **Envío del Momento 1:** al pasar a Compra con el total pagado, programar la plantilla a los 7 días (hora del
   cliente, 7–21), solo compradores nuevos; botón «Me quedó bien» → el Agente IA manda su enlace; «Tuve un problema» →
   tarjeta amarilla al vendedor y el Agente IA no contesta ese chat; «Aún no la instalo» → otra vez a los 7 días;
   sin respuesta → un 2.º intento a los 7 días. Ajustes (prender, días, hora) en Seguimientos › Opinión.
2. **La opinión en la ficha del contacto** y la tarjeta **Opiniones** del Dashboard (pedidas, contestaron, promedio,
   publicables, fotos/videos, vecinos que llegaron y cuánto compraron).
3. **Recomendaciones:** un contacto nuevo que trae «Mi código es DILU-XXXX» queda ligado a quien lo recomendó; el
   canje en la página web cuando se defina el premio (hace falta saber con qué está hecha la página).
4. **Momento 2** (lluvia), cuando la cinta del clima esté en main.

## 6. Pendientes y riesgos

- Si se quiere, cambiar el enlace de Google por el de «Pedir reseñas» del Perfil de Negocio, que abre directo la caja
  de la reseña.
- El mensaje de «Compartir con un vecino» lleva un enlace largo (wa.me con el texto ya escrito). Si estorba, un
  enlace corto propio del CRM que redirija.
- El permiso para publicar no enlaza todavía a un aviso de privacidad (falta saber su dirección).
- La dirección pública de Railway se ve rara en WhatsApp; el subdominio de la página web lo resuelve (un registro
  CNAME hacia Railway, sin servicio nuevo).

## 7. Amazon y Mercado Libre (27-oct-2026)

Pedido del dueño: hay clientes que, al darles seguimiento, contestan que **ya compraron** la compuerta en Amazon o en
Mercado Libre. Antes solo quedaban en «No seguir» y nadie los volvía a ver. Ahora se les pide una reseña en esa tienda,
con foto o video, **con el menor gasto de IA posible**. OK del dueño a los puntos 1–3 el 27-oct-2026.

1. **El lector anota dónde compró, sin llamada extra.** La lectura en segundo plano que llena el Detalle
   (`docs/agente-ia/2026-09-28-segundo-plano-etapa-y-detalle.md`) ya leía cada chat y ya reconocía «ya compró en otro
   lado». Se le agregó un campo, `compro_en` (amazon | mercado_libre), solo si el cliente **ya** compró o pidió ahí (no si
   pregunta por esas tiendas, pide el enlace o dice que la va a comprar). **Candado en el código**, como con los montos:
   solo vale si un mensaje del **cliente** nombra esa tienda (la empresa las nombra siempre al dar las opciones de
   compra). No toca el Goal ni las FAQs. La ficha guardada que lee el lector dice «Compró en otra tienda: …».
2. **Subpestaña «Amazon y Mercado Libre»** en Seguimientos (mapa 3.11 › 22–32): quién, tienda, su frase, estado
   (por pedir → pedida → la dejó / no quiso). «No compró ahí» lo descarta y el lector ya no lo vuelve a anotar.
3. **«Pedir reseña» con texto fijo, sin IA** (`lib/resenas-tienda/mensaje.ts`, texto aprobado): saludo de la hora del
   cliente, gracias por comprar en esa tienda, su opinión «cuando ya la tenga instalada» con foto o video, el enlace de la
   tienda (Seguimientos › Enlace de Mercado Libre; vacío = explica dónde se deja) y que mande la foto por WhatsApp también.
   Sale como mensaje del vendedor (pausa al Agente IA en ese chat) y **solo con texto libre**: WhatsApp dentro de 24 h,
   Instagram hasta 7 días. **Solo Mercado Libre** desde el ajuste del 27-oct (ver abajo). Se ve antes de mandarlo. Con tienda anotada, el lector nunca le arma un seguimiento de venta
   (`no_seguir` forzado en el código; ya era la regla de sus instrucciones).

**Reglas de las tiendas:** nada a cambio (ni descuento, ni regalo, ni el código de recomendación), sin pedir
«5 estrellas» y a todos por igual, no solo a los contentos. El CRM no puede saber si la dejó: lo marca el vendedor.

**Modelo:** tabla `resenas_tienda` (una por contacto; tienda, frase, origen lector|manual, estado, pedida_at) y
`opiniones_config.amazon_resena_url` / `mercado_libre_resena_url` (migración 0074).

**Casos anteriores** (lectura de producción del 27-oct-2026 con OK del dueño, sin IA: mensajes del cliente que nombran
la tienda y motivos de «No seguir»): 3 dijeron que ya la pidieron en Amazon y 2 en Mercado Libre (uno de ellos solo dijo
que la iba a encargar). Los nombres están fuera del repo (`~/Documents/Diluvium CRM/reportes/resenas-tiendas/`). Entran
a la lista solo con OK aparte de escritura en producción.

**Revisión de esos casos (27-oct-2026):** el dueño confirmó 4 y descartó 1 (tenía un problema de piezas abierto).

### Lo que permiten las tiendas (investigación del 27-oct-2026; detalle fuera del repo, `reportes/resenas-tiendas/`)

- **Ninguna API dice «este teléfono compró aquí».** Amazon (SP-API) solo da el teléfono con un rol restringido y lo
  oculta tras la entrega; Mercado Libre no lo da en Mercado Envíos 2. Las dos prohíben usar los datos del comprador para
  algo que no sea el envío o los impuestos. Por eso la detección sigue siendo el lector (lo que el cliente dice en el chat).
- **Amazon no deja escribirle al comprador fuera de su servicio de mensajes** (código de conducta para vendedores en
  México, G1801). La reseña de Amazon se pide con su botón **«Solicitar una reseña»** en Seller Central (del día 5 al 30
  después de la entrega; una por pedido); nunca por WhatsApp. El CRM solo lo anota («Ya la pedí en Amazon»). Para
  después, sin OK: la Solicitations API de Amazon hace lo mismo sola para todos los pedidos, gratis.
- **Mercado Libre prohíbe escribirle por otro medio (menciona WhatsApp) hasta que vence Compra Protegida**: 30 días después
  de recibirla (cláusula 3 b de sus términos). El CRM deja «Pedir reseña» a los **40 días** de que lo dijo (una semana
  para la entrega). Sus calificaciones tampoco se pueden usar fuera de Mercado Libre (3 c): no van en anuncios.

### Ajuste con OK del dueño (27-oct-2026)

- Filas de **Amazon**: en lugar de «Pedir reseña», «Pídala en Seller Central…» y el botón **Ya la pedí en Amazon** (queda
  «Pedida»). `pedirResena` rechaza las de Amazon en el servidor (`bloqueoDe`).
- Filas de **Mercado Libre**: «Pedir reseña» desde el día 40; antes dice desde qué fecha. Con la ventana cerrada, se manda
  la plantilla `resena_tienda` desde el chat y su respuesta abre la ventana.
- **Plantilla `resena_tienda`** (id de Meta 1798462208055679, es_MX, pedida como UTILITY, dada de alta el 27-oct-2026 por
  la API de Zernio): «Hola, le escribo de parte del equipo de Diluvium por la compuerta que pidió en {{1}}. ¿Ya la pudo
  instalar? Nos ayuda mucho saber cómo le quedó.» Botones: Me quedó bien · Tuve un problema · Aún no la instalo. No pide
  la reseña (así es Utilidad, como `opinion_compuerta`); solo reabre la conversación. En el selector 📄 se llama
  «Reseña en tienda» y su {{1}} ya viene con «Mercado Libre».
- La caja de enlaces solo pide el de Mercado Libre (el de Amazon ya no va en ningún mensaje; la columna se queda).

### Rediseño de la lista (27-oct-2026, noche; pedido del dueño: «lo más simple, concreto y fácil de entender»)

- **Una sección y una acción por cliente, sin marcar nada a mano** (`pasoDe` en `lib/resenas-tienda/vista.ts`):
  - **Para pedir**: Amazon (botón **Pedir en Amazon** → pedidos de Seller Central, hasta 35 días después de que lo dijo;
    después sale solo de la lista); Mercado Libre ya pasados los 40 días: **Pedir reseña** (texto fijo, ventana abierta) o
    **Mandar plantilla** (`resena_tienda` con un clic desde la lista, ventana cerrada).
  - **En espera**: Mercado Libre antes de los 40 días, o con la plantilla ya mandada esperando que conteste (se sabe por
    `messages.template_name`, sin columna nueva).
  - **Ya pedidas**: salió el texto.
- **Se quitaron** (el dueño marcó por error una de Amazon como pedida al probar): «Ya la pedí en Amazon», «La dejó / No
  quiso», el estado de cada fila y la caja de enlaces. «No compró ahí» ahora es **Quitar**, con el aviso de arriba del CRM.
  Las de Amazon ya no usan el estado: una marcada como pedida por error vuelve sola a «Para pedir».
