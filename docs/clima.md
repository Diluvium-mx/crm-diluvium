# Cinta del clima (barra de arriba)

Decisión del dueño (1 y 2-oct-2026). En la barra azul, entre el logo y el correo, corre una cinta con el clima
**medido** (no pronosticado) de las 24 ciudades de México donde más llueve. Mapa del CRM: Menú › 14.

## Qué muestra y cómo

- Por ciudad: **icono** (lo que pasa ahora), **ciudad**, **grados** y **lluvia de las últimas 24 h** en mm. Sin
  texto tipo «Nublado»: el icono lo dice (para lectores de pantalla va la palabra oculta).
- Iconos (lucide): sol / luna (despejado, según si el sol está arriba en esa ciudad), nube con sol / con luna
  (medio nublado), nube (nublado), niebla, llovizna, lluvia, tormenta. Llovizna, lluvia y tormenta van en
  **naranja** y esas ciudades pasan al frente (más mm primero); el resto, en el orden del ranking.
- Milímetros: con un decimal hasta 10 mm («0.4 mm», «8.9 mm») y redondeados desde 10 («173 mm»). **Si no llovió**
  (o redondeado da 0) no se pone nada: solo icono, ciudad y grados (regla del dueño, 2-oct-2026: ningún dato en 0).
- Corre **siempre** de derecha a izquierda a 40 px/s; **nada la detiene** (ni el mouse: `pointer-events: none`,
  sin globo). Con «Reducir movimiento» del sistema queda quieta.
- Solo de **lunes a sábado de 9:00 a 19:00, hora de Mazatlán** (el mismo horario laboral del monitoreo,
  `lib/monitoring/business-hours.ts`), solo en computadora (≥ 768 px) y solo con sesión. Si el aviso
  «Hay una nueva actualización del CRM» está a la vista, la cinta le cede el centro.

## De dónde salen los datos (gratis, sin llave ni cuenta)

| Dato | Fuente | Qué es |
|---|---|---|
| Icono y grados | METAR del aeropuerto de la ciudad, `aviationweather.gov/api/data/metar` (Servicio Meteorológico de EE. UU.) | Medición del observatorio del aeropuerto, cada hora (y antes si el clima cambia). Límite: 100 consultas por minuto; pide User-Agent propio. |
| Lluvia de 24 h | SYNOP del observatorio del SMN-Conagua en la misma ciudad, vía `ogimet.com/cgi-bin/getsynop?block=76` | Grupo `7RRRR` de la sección 333: lluvia de las 24 h **anteriores** a cada reporte, en décimas de mm, cada hora. Los reportes son de cada país (Resolución 40 de la OMM, intercambio libre). |

Descartadas (1-oct-2026): MET Norway y Open-Meteo (pronóstico, no medición: MET falló hasta 6.6 °C contra los
aeropuertos; Open-Meteo además prohíbe el uso comercial gratis), el servicio web de Conagua (pronóstico del día
anterior, 104 MB por consulta) y las estaciones automáticas de Conagua (no publican datos por internet).

## Cada cuánto y dónde vive

- El worker revisa cada 5 min (`worker/index.ts` → `lib/clima/sync.ts`) y consulta **una vez por hora** en horario
  de trabajo, desde las 8:50 para que a las 9:00 ya haya datos. Son **2 consultas por hora** (una a cada fuente).
  Si una falla (o responde sin reportes, o ninguna ciudad pasa las revisiones), la foto anterior se queda y se
  reintenta en 15 min.
- La foto se guarda en **Redis** (`clima:cinta:v1`, vence en 6 h), como la de las cuentas de WhatsApp: no es dato de
  clientes ni de una organización, así que no hay tabla ni migración. La barra la lee al cargar la página y cada
  10 min (`lib/clima/actions.ts`); si Redis falla o tarda más de 300 ms, la cinta no sale y la página no se frena.
- Si la foto tiene más de 2 h (el worker no pudo traer el clima), la cinta se esconde: nunca muestra datos viejos.

## Revisiones (cada hora, por ciudad)

Una ciudad que no pasa alguna **no sale esa hora** (se registra como `[clima] fuera esta hora: …` en el log del
worker):

1. El aeropuerto reportó hace ≤ 2 h, con temperatura (se lee del reporte original: con «34///», sin punto de rocío,
   el JSON del servicio deja la temperatura vacía).
2. El aeropuerto está a ≤ 30 km del observatorio (con las coordenadas que manda el propio servicio). Así se
   detectó que MMTL ya no es Tulancingo sino el aeropuerto de Tulum.
3. El observatorio reportó la lluvia hace ≤ 3 h.
4. Los grados del aeropuerto y los del observatorio no difieren más de 5 °C (dos mediciones de la misma ciudad).
5. Lluvia: manda el último reporte (la ventana de 24 h baja sola cuando la lluvia vieja sale). Un salto de más de
   50 mm **sin** lluvia en el aeropuerto en las últimas 3 h espera al siguiente reporte para confirmarse (dato
   suelto raro, como Río Verde: 155.2 entre 93.9 y 92.7).

Lo que va «en las cercanías» del aeropuerto (`VCSH`, `VCTS`) y lo que dicen las observaciones (`RMK`) o la
tendencia (`TEMPO`) no cuenta para el icono. El grupo `6RRRR` que algunos METAR mexicanos traen en `RMK` es irregular
y no se usa.

## Las 24 ciudades

`lib/clima/ciudades.ts`. Salen del ranking de horas con lluvia en horario de trabajo (lun–sáb 9–19 Mazatlán,
oct-2024 → sep-2026, archivo METAR del Iowa Environmental Mesonet; ≥ 1.5 % de las horas = 41 aeropuertos) menos los
que no tienen observatorio de Conagua en la misma ciudad (sin lluvia medida, no va; decisión del dueño). Ranking y
cálculo: `~/Documents/Diluvium CRM/reportes/clima-barra/`. Para cambiar la lista se edita ese archivo (aeropuerto,
observatorio y coordenadas del observatorio).

## Costo y riesgos

- **$0**: las fuentes no tienen cuenta, tarjeta ni llave. En Railway son unos KB por hora (menos de un centavo de
  dólar al mes).
- Si una fuente se cae o cambia su formato (se valida con Zod), la cinta se esconde o pierde esas ciudades; el resto
  del CRM no se entera. La consulta tiene límite de 10 s y corre aparte de los envíos y del Agente IA.
- OGIMET es el sitio de un voluntario, sin garantía. Si falla, la consulta de esa hora falla completa (sin mm no va
  ninguna ciudad, regla del dueño): la foto anterior sigue hasta cumplir 2 h y después la cinta se esconde hasta
  que vuelva.
