# Corrector ortográfico

20-oct-2026, rama `feature/corrector-ortografico`. Pedido del dueño: que las cajas donde escribe el vendedor señalen
las palabras mal escritas, sin costo y sin extensiones del navegador. En el mapa: Bandeja › Caja para escribir › 103–104
y el Glosario.

## Qué hace

- Subraya las palabras mal escritas mientras se escribe con **el mismo subrayado del navegador** (`text-decoration-line: spelling-error`; donde no existe, una onda roja de 1 px; `[data-spelling-error]` en `app/globals.css`). El primero era una onda de 1.5 px y al dueño le pareció demasiado grande (20-oct-2026). La palabra en curso no se marca hasta
  salir de ella. Nunca impide enviar.
- **Clic izquierdo** en una palabra subrayada abre un menú estilo Apple pegado a ella, **siempre arriba** de la palabra en todas las cajas (decisión del dueño, 20-oct-2026; solo si no cabe arriba se va abajo):
  hasta 3 palabras correctas en negritas, **Ignorar** (solo en ese mensaje; se olvida al vaciar la caja) y
  **Agregar al diccionario** (diccionario del equipo: ya no se marca para nadie de la organización).
- Solo ortografía, no gramática (decisión del 20-oct-2026: la gramática necesitaría LanguageTool en Railway,
  ≈ US$10–20/mes; queda como opción B si hace falta).

Cajas con corrector (las del vendedor): la del chat (`composer.tsx`), 🕒 Programar (`schedule-form.tsx`), Editar mensaje
del seguimiento (`followup-editar-mensaje.tsx`), el primer mensaje de un contacto sin chat (`first-message.tsx`) y el texto
de Mensajes rápidos y Plantillas (`fragmentos-tab.tsx`, `plantillas-tab.tsx`). **No** en Goal, FAQs ni demás cajas del
Agente IA o de configuración, ni en el formulario público de Opinión.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Diccionario abierto de español de México (Hunspell de LibreOffice, ~0.9 MB, licencia GPL/LGPL/MPL) | `public/diccionario/` (copia del paquete `dictionary-es-mx`; `rules.test.ts` falla si dejan de coincidir) |
| Revisor `nspell` dentro de un **Web Worker** (carga el diccionario una vez, ~0.3 s; la página nunca se traba) | `lib/spelling/spell.worker.ts`, puente `client.ts` |
| Reglas: qué se marca y qué se sugiere | `lib/spelling/rules.ts`, palabras del texto en `tokens.ts` |
| Subrayado y menú (se pone **justo antes** de la `<textarea>`; no le cambia nada a la caja) | `components/spelling/spellcheck-overlay.tsx`, `spelling-menu.tsx` |
| Diccionario del equipo | tabla `spelling_words` (migración 0068), `lib/spelling/store.ts`, `lib/actions/spelling.ts`, contexto en `app/(app)/_components/spelling-provider.tsx` |

- El subrayado es una copia invisible del texto encima de la caja, con la misma letra, medidas y scroll; solo se ve la
  línea roja. El subrayado nativo del navegador se apaga en esas cajas para que no salgan dos.
- Cambiar la palabra usa `insertText` (como si se tecleara): el `onChange` de cada caja sigue igual y Cmd+Z lo deshace.
- **No se marcan:** enlaces, correos, @usuarios, `{{variables}}`, comandos `/…`, lo que lleve números, siglas en
  mayúsculas (IVA, CFE), las `BASE_WORDS` (Diluvium, Mazatlán, Los Mochis, Culiacán, cm, mts…) y el trato de usted con
  pronombres pegados («mándeme», «cotizarle», «envíeselo»: se quita el pronombre y se revisa el verbo).
- **Sugerencias:** primero los atajos de chat («porfavor» → «por favor», «xq» → «porque»), luego lo que solo difiere en
  un acento o ñ («cotizacion» → «cotización») y después las del diccionario.
- Permiso `spellingWord: read, create` para todos los roles (decisión del dueño: cualquiera agrega palabras). Las palabras
  del equipo se releen al volver a la pestaña del CRM.

## Costo

Cero: no usa IA ni servicios de terceros; el texto no sale de la computadora del vendedor (solo la palabra que se
agrega al diccionario va a la base del CRM).
