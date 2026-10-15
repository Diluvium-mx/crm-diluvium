# El lector ve el año (14-oct-2026, sin migración)

**Origen:** auditoría del 14-oct (lectura de producción). Las horas del chat que lee el lector en segundo plano no
traían el año («10 oct 17:13») y su instrucción no dice la fecha de hoy. Cuando el cliente pedía un día («mañana mido»),
el lector llenaba `fecha_pedida` con un año viejo («2024-10-14», «2025-10-10»): **58 de 148 fechas pedidas del 1 al
14-oct (39 %), en 47 chats** (34 con 2024, 23 con 2025 y 1 con 2022). Ejemplo: el 10-oct (sábado) una clienta dijo «el
lunes mido»; el lector escribió 2024-10-14, se descartó, y el domingo le salió «¿Pudo medir?»; contestó «Si ya le dije
que hasta el lunes puedo ir a medir» y nadie le respondió (ver F2). `parseFicha` las descartaba por «ya pasó» y el cliente no recibía el seguimiento ese día.

**Cambio (OK del dueño, 14-oct):**
- `lectorTime` (`lib/ai/runtime/lector-core.ts`) lleva el año: «10 oct 2026, 17:13».
- `parseFicha` (`lib/followups/ficha.ts`): una fecha pedida que ya pasó y que, con el año de hoy o el siguiente (de
  diciembre a enero), cae en el rango permitido (hoy → 60 días) se toma con ese año. Una fecha de verdad pasada se sigue
  descartando igual.
- La guarda contra un «[hora] Vendedor:» escrito por el cliente (`clientLine`) también reconoce la hora con año.

**Cómo vigilarlo en producción:** `ai_usage.error ~ 'fecha_pedida: 202[0-5]'` debe dejar de aparecer, y los
`follow_ups` con caso `pidio_fecha` deben salir el día que pidió el cliente. Sin banco con modelos (regla del 9-oct).
