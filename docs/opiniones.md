# Opiniones después de la compra

> Diseño y estado de la pestaña **Seguimientos** del menú (subpestaña **Opinión**) y del formulario público
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
