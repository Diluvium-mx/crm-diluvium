# Renglón sin palabras y símbolos de programación = texto interno (3-nov-2026, sin migración)

**Qué pasó.** El 2-nov a las 10:45 p.m. un cliente contestó «Si» a «¿Usted tiene problemas de inundaciones?» y
GPT-5.6 Luna (Prospecto) contestó en UNA respuesta «¿Hasta qué altura aproximada le sube el agua?» y, en un renglón
aparte, «[]{?}». El CRM la partió en dos burbujas y salieron las dos: el registro la marca como normal (sin
reintento, sin tarjeta). Luna no anotó «tiene inundaciones» en el Detalle (lo anotó el lector a las 10:49): «[]{?}»
era su llamada a `actualizar_detalle` escrita como texto, la misma falla del
[19-oct](2026-10-19-parte-limpia-y-eco-de-otro-tipo.md) con otra forma. El 25-oct a las 8:54 a.m. pasó igual en otro
chat con una burbuja de solo U+5FFFF (un código que no es letra; al cliente le llega en blanco o como cuadrito).

**Por qué se coló.** Las reglas de `lib/ai/runtime/internal-text.ts` buscaban FORMAS de basura (corchetes con texto,
JSON con nombres, «tool», una palabra suelta). Las dos burbujas no tenían ni una letra.

**Revisión en producción (3-nov, OK LECTURA PROD).** Todos los mensajes del Agente IA del 27-sep al 3-nov (22,477
mensajes, 22,933 renglones), buscando renglones sin letras ni números o con `{ } [ ] < >`, «```», «|» o «\»: solo
salieron «[]{?}», la burbuja U+5FFFF y las notas viejas del 1 al 4-oct (ya frenadas desde el
[5-oct](2026-10-05-texto-interno-sin-completar.md)). «😊» (2 veces) es emoji y pasa. Ningún mensaje bueno se habría
frenado. Desde el 19-oct el candado frenó 10 de 2,913 respuestas de Luna (9 salvadas con el reintento).

**Regla.** Además de las de antes, un renglón para el cliente es texto interno si:
- no tiene nada que se pueda leer: ni letra, ni número, ni emoji, ni bandera («[]{?}», «{}», «¿?», «...», «━━━━»,
  caracteres invisibles); los renglones en blanco entre párrafos no cuentan;
- trae símbolos de programación: `{ } [ ] < >`, «```», «|» o «\» («<tool>», «Hola {nombre}»).

Todo lo demás sigue igual: el CRM pide otra respuesta al mismo modelo una vez
([reintento del 10-oct](2026-10-10-texto-interno-reintento.md)) y, si vuelve a fallar, sale el texto bueno que iba antes
(parte limpia); solo sin texto bueno, tarjeta y pausa. Aplica en las tres puertas: la respuesta (`run.ts`), los
seguimientos (`lib/followups/dispatch.ts`) y el último candado antes de WhatsApp (`sendAgentText`). Los mensajes de
link de pago y los que escribe un vendedor no pasan por esta regla. La nota del reintento ya menciona los símbolos y
el renglón sin palabras (va en el contexto, no en el system: la caché no cambia). Sin cambios al Goal ni a las FAQs.
