# Cobro de Zernio en el Dashboard

Pedido del dueño (23-oct-2026): tener todos los costos del CRM en el Dashboard, en un mismo lugar. Zernio es por
donde entran y salen los mensajes de WhatsApp e Instagram. Lo que Meta cobra por WhatsApp (plantillas y, desde el
1-oct-2026, mensajes de servicio) NO pasa por Zernio: Meta lo carga directo a la cuenta de WhatsApp. El CRM lo lee
de Zernio, que da lo que reporta Meta (`docs/meta-whatsapp.md`, tarjeta «WhatsApp (Meta)»).

## Cómo cobra Zernio (docs.zernio.com/pricing, leído el 23-oct-2026)

- Sin cuota base. Cuentas conectadas: las 2 primeras gratis (un crédito de US$12 al mes que solo cubre esa línea).
- Mensajes enviados (respuestas, workflows, seguimientos; desde el 1-oct-2026): los primeros 10,000 del mes gratis,
  luego US$0.0001 cada uno (US$1 por 10,000). Instagram también cuenta.
- Mes calendario en días UTC. Cobra a la tarjeta conforme se junta el consumo (el primer cargo al llegar a US$10).
- Primera lectura real (23-oct): octubre US$0.71 (solo mensajes; las cuentas salieron cubiertas por el crédito),
  septiembre US$0.

## La factura de octubre de 2026 (revisada el 2-nov-2026)

Recibo #2351-8052, cobrado el 1-nov a la tarjeta: **US$1.05**, lo mismo que leyó el CRM. Renglón por renglón:

- **Managed Messages · Qty 105 × US$0.01 = US$1.05.** La factura junta los mensajes en unidades de US$0.01 (100
  mensajes): 10,500 por encima de los 10,000 gratis.
- **Connected Accounts (priced) · 657 + 504 = US$11.61**, menos el mismo monto de **Free Tier Credit**: US$0. Las
  cuentas se cobran por día (US$6 al mes cada una entre el día del mes): con 2 cuentas el mes completo son US$12, justo el
  crédito, en meses de 30 o 31 días. En octubre la 2.ª cuenta (Instagram) empezó el día 3. Una 3.ª cuenta sí costaría
  US$6 al mes.
- **Zernio anota los mensajes de cada día al día siguiente** (`dailyUsd` de `/v1/usage`): lo del 31-oct (US$0.03)
  salió el 1-nov, en la factura de noviembre. Por eso el día 1 de cada mes ya se ven unos centavos de mensajes.
- Comparado con la base: 20,737 mensajes del CRM en octubre (días UTC; vendedor desde el CRM y Agente IA, sin fallidos,
  sin ecos del celular ni importados) → (20,737 − 10,000) × 0.0001 = US$1.07. Zernio cobró 1.05 + 0.03 = US$1.08. Día por
  día cuadra con un día de corrimiento (p. ej. 13-oct: 1,046 mensajes → US$0.10 anotados el 14-oct).
- El estimado anterior de «≈ US$1.5 al mes» estaba alto: un mes de ≈20,000 mensajes cuesta ≈ US$1.

## Factura estimada del mes (desde el 2-nov-2026)

Zernio solo da dinero, y los mensajes valen US$0 hasta pasar los 10,000 gratis (a media quincena), así que su consumo no
sirve para proyectar. La tarjeta cuenta en la base los mensajes del mes (`countZernioSent`, mismo filtro que la
comparación de arriba) y los lleva al mes completo (`estimateZernioBill`): (proyectados − 10,000) × US$0.0001, nunca
menos de lo que Zernio ya cobró por mensajes, más las cuentas y otros cargos tal como van. El primer día no se calcula
(como la factura estimada de Railway). No hace falta migración: el conteo sale de `messages` al abrir el Dashboard.

## Cómo funciona

- El **worker** lee cada 15 min (y al arrancar) `GET /v1/usage?range=cycle` (el consumo del mes, que cuadra renglón
  por renglón con la factura), `GET /v1/usage?range=prev-cycle` (el mes anterior; si falla, la tarjeta sale sin él)
  y `GET /v1/billing` (cuenta suspendida, tarjeta rechazada, factura abierta) — `lib/zernio-billing/`. Solo lee: no
  cambia nada ni cuesta nada. Usa la misma `ZERNIO_API_KEY` (y `ZERNIO_BASE_URL` si existe) con la que el CRM
  manda mensajes: no hay variable nueva.
- Guarda la última lectura buena en `zernio_billing` (migración 0070; una fila por organización). Si Zernio falla
  se guarda el error (sin la llave) y se conserva lo anterior. El enlace de una factura abierta no se guarda.
- El **Dashboard** muestra la tarjeta **Zernio (WhatsApp e Instagram)** debajo de Railway (mismos permisos;
  `lib/dashboard/zernio.ts`, `app/(app)/inicio/_components/zernio-card.tsx`; mapa 3.1 › 55–58): lo que va del
  mes, mensajes y cuentas por separado, el mes anterior y el aviso naranja de pago pendiente o cuenta suspendida. Desde
  el 2-nov-2026 arriba va la **factura estimada** del mes (mapa 3.1 › 114) y los mensajes enviados contra los 10,000
  gratis (57).
