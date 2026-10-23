# Cobro de Zernio en el Dashboard

Pedido del dueño (23-oct-2026): tener todos los costos del CRM en el Dashboard, en un mismo lugar. Zernio es por
donde entran y salen los mensajes de WhatsApp e Instagram. Lo que Meta cobra por WhatsApp (plantillas y, desde el
1-oct-2026, mensajes de servicio) NO pasa por Zernio: Meta lo carga directo a la cuenta de WhatsApp (ver
`docs/meta-costos.md` en la rama `feat/meta-costos`).

## Cómo cobra Zernio (docs.zernio.com/pricing, leído el 23-oct-2026)

- Sin cuota base. Cuentas conectadas: las 2 primeras gratis (un crédito de US$12 al mes que solo cubre esa línea).
- Mensajes enviados (respuestas, workflows, seguimientos; desde el 1-oct-2026): los primeros 10,000 del mes gratis,
  luego US$0.0001 cada uno (US$1 por 10,000). Instagram también cuenta.
- Mes calendario en días UTC. Cobra a la tarjeta conforme se junta el consumo (el primer cargo al llegar a US$10).
- Primera lectura real (23-oct): octubre US$0.71 (solo mensajes; las cuentas salieron cubiertas por el crédito),
  septiembre US$0.

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
  mes, mensajes y cuentas por separado, el mes anterior y el aviso naranja de pago pendiente o cuenta suspendida.
