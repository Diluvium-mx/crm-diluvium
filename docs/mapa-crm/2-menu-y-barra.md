> Parte del [Mapa del CRM](../mapa-crm.md) (índice con todas las secciones). Las capturas están en esta misma carpeta.

## 2. Menú y barra de arriba

Lo que se ve en todas las pantallas.

![Menú lateral y barra de arriba](00-marco.png)

![Menú de un vendedor (sin Configuración)](00-marco-vendedor.png)

![Confirmación de «Cerrar sesión»](00-marco-cerrar-sesion.png)

![Aviso de actualización en la barra de arriba](00-aviso-actualizacion.png)

| # | Nombre oficial | Qué hace | Quién lo ve |
|---|---|---|---|
| 1 | **Menú lateral** | Lista de pestañas: Dashboard, Bandeja, Embudo, Mensajes rápidos, Anuncios, Agente IA, Automatización, **Seguimientos** (desde el 8-oct-2026), Configuración. Desde el 14-oct-2026 cada pestaña lleva su **ícono**, que hace un gesto corto **una sola vez** al pasar el cursor (o al llegar con Tab), como en Zernio: Dashboard, los cuadros aparecen uno por uno · Bandeja, brincan los puntitos de «escribiendo» · Embudo, cae una gota · Mensajes rápidos, se dibuja el rayo · Anuncios, se sacude el megáfono · Agente IA, parpadean las chispas · Automatización, se traza la conexión · Seguimientos, gira la estrella · Configuración, gira el engrane. Con «Reducir movimiento» en la computadora no se mueven. | Todos (Configuración solo Owner y Admin) |
| 2 | **Pestaña activa** | La pestaña en la que estás, resaltada con una barra blanca (a la izquierda de su ícono). | Todos |
| 3 | **Logo Diluvium** | Solo identifica la marca; no es botón. | Todos |
| 4 | **Correo de la sesión** | Con qué cuenta entraste. | Todos |
| 5 | **Tema claro / oscuro** (píldora) | Interruptor en forma de píldora (1-oct-2026): la bolita muestra el **sol** en tema claro, con nubes que flotan despacio, o la **luna** en tema oscuro, con estrellas que titilan; lo del otro tema no se ve. Al tocarlo, la bolita se desliza y el tema nuevo se extiende **en círculo desde el botón** por toda la pantalla. Se recuerda en esa computadora. Tiene efectos del cielo. Con «Reducir movimiento» en la computadora cambia sin animaciones. | Todos |
| 6 | **Cerrar sesión** | Ya no sale directo: abre el globo de confirmación (10). | Todos |
| 7 | **Menú del usuario** (nombre y rol) | Abre **Mi cuenta** y **Cerrar sesión** (ver [Menú del usuario y Mi cuenta](3.9-menu-del-usuario.md#39-menú-del-usuario-y-mi-cuenta)). | Todos |
| 8 | **Menú del vendedor** | Igual al de arriba pero **sin Configuración**. | Vendedor |
| 9 | **Rol "Vendedor"** | Debajo del nombre se ve el rol de quien entró (Owner, Admin o Vendedor). | Todos |
| 10 | **Globo «¿Cerrar sesión?»** | Sale pegado al botón que tocaste —el de la barra (6), el del menú del usuario (7) o el del cajón ☰ en el celular— con «Saldrás del CRM en este dispositivo». Esc o un clic fuera lo cierran sin salir. Desde el 1-oct-2026. | Todos |
| 11 | **Cancelar** | Cierra el globo y te deja donde estabas. Ya viene seleccionado: un Enter no te saca por error. | Todos |
| 12 | **Cerrar sesión** (naranja) | Ahora sí sale del CRM (dice «Saliendo…» mientras). | Todos |
| 13 | **Aviso de actualización** | Píldora en la barra azul: **«Hay una nueva actualización del CRM: recarga la página»** con el botón naranja **Recargar**. Sale **solo** cuando falló algo que hizo el vendedor (enviar, guardar, adjuntar, abrir un PDF…) porque su pestaña es de antes de una actualización del CRM. **Nunca** sale solo por haber versión nueva, ni por un refresco automático que falló (mensajes nuevos, programados). Donde falló, el mensaje propio también lo dice en la burbuja al enviar, la foto HEIC, el PDF del visor y Mensajes rápidos; las demás pantallas conservan su mensaje. Se quita al recargar. En celular baja como franja azul debajo de la barra (Versión móvil › 13). | Todos |

**En celular** (pantalla de menos de 768 px) el menú lateral se esconde y la barra lleva un botón ☰ que abre el
mismo menú en un cajón; ver [Versión móvil](3.10-version-movil.md#310-versión-móvil-celular).

**Lo cambias tú desde la pantalla:** el tema claro u oscuro.

**Pídeselo a Code:**
- "En Menú › (1) menú lateral, pon Anuncios antes de Mensajes rápidos."
- "En Menú › (4) correo de la sesión, muestra mi nombre en vez del correo."
- "En Menú › (1) menú lateral, cambia el ícono de Anuncios por uno de cohete."

<sub>Para Code: `app/(app)/layout.tsx` (sidebar y barra), `nav-item.tsx`, `nav-icons.tsx` (íconos del menú; su movimiento en `app/globals.css` › «Íconos del menú»), `user-menu.tsx`, `sign-out-button.tsx` y
`sign-out-confirm.tsx` (globo 10–12), `components/theme-toggle.tsx` (píldora), `theme-circle-transition.ts` (círculo),
`theme-sky-effects.ts` (efectos del cielo); estilos en `app/globals.css` › «Interruptor de tema»; aviso de actualización (13): `update-notice.tsx`, `lib/version/` y
`app/api/version/route.ts`.</sub>
