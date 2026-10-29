# Nombre del cliente: solo el que dio el cliente (28-oct-2026, sin migración)

**Qué pasó.** El 28-oct a las 5:04 p.m. el Agente IA le contestó a una clienta «Claro, Carlos. Quedamos a sus
órdenes…». Carlos es el vendedor: dos días antes había escrito «Hola muy buenos días, aquí Carlos de Diluvium».
La clienta estaba en Interesado (Modelo 2, Sonnet 5.5) y escribió «Enterado cualquier duda los contacto». Sonnet
calló (bien: ya se le había dicho «Si le surge cualquier duda…»), pero esa frase no cuenta como acuse, así que el
silencio contó como respuesta vacía y contestó GPT-5.6 Luna (red contra el silencio). Luna tomó el único nombre del
chat. El modelo no recibe el nombre del cliente y los mensajes del vendedor le llegan como suyos
(`lib/ai/runtime/transcript.ts`), así que cualquier modelo puede volver a confundirlo. Dueño: «por nada del mundo
debe suceder».

**Regla (arreglo A, OK del dueño).** El Agente IA solo llama al cliente por un nombre que el CLIENTE dio: lo escribió,
lo dijo en una nota de voz o está en su perfil (nombre, apellido o usuario de Instagram). Lo que escribió el vendedor
no cuenta, porque ahí va su propio nombre. Cualquier otro nombre con el que se dirija al cliente se quita de la
burbuja antes de enviarla y el resto sale igual: «Claro, Carlos. Quedamos…» → «Claro. Quedamos…». Sin tarjeta ni
pausa; queda una línea en el registro del worker («se quitó un nombre que el cliente no ha dado»).

**Cuándo es un nombre para dirigirse al cliente.** Va después de una coma y antes de un signo, un emoji o el final
(«Gracias, Sandra.», «Quedamos a sus órdenes, Carlos.», «Mire, Carlos, le explico…»), o justo después de un saludo al
inicio de la frase («Hola Carlos,», «Buenas tardes Carlos.»). Antes de la coma va una palabra en minúscula o el inicio
de la frase: «Estamos en Los Mochis, Sinaloa.», «Paiporta, Valencia.» o «123, Col. Centro» son lugares o direcciones.
Marcas, paqueterías, estados y cortesías nunca cuentan como nombre (Mercado Libre, Amazon, México, Sinaloa,
Igualmente…). Un nombre de dos palabras sale completo si el cliente no dio las dos. Sin acentos ni mayúsculas
(«soy ramon» deja pasar «Ramón»).

**Revisión en producción (28-oct, solo lectura).** De los 15,889 textos del Agente IA, 1,708 tienen una coma o un saludo
antes de una palabra con mayúscula. Con la regla, solo cambia uno: «Claro, Carlos». Todos los demás nombres que ha usado
(los que el cliente escribió, dictó —«Javier» en una nota de voz— o tenía en su perfil) salen igual.

**Dónde.** `lib/ai/runtime/nombre-cliente.ts` (regla, pura) y `run.ts`, después de quitar repeticiones y antes del
pie de archivo y el envío: es el único camino por el que sale texto del modelo (la «respuesta guardada» que se reenvía
ya pasó por aquí). El perfil lo lee `loadContactNames` (`context.ts`).

**No se cambió (decisión del dueño).** El acuse («Enterado cualquier duda los contacto» sigue sin contar como acuse)
ni la red contra el silencio: con el candado, el mensaje sale sin el nombre.
