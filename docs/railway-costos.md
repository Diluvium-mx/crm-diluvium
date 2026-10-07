# Cobro de Railway en el Dashboard

Decisión del dueño (7-oct-2026): ver lo que va costando Railway sin entrar a Railway. Desde el cambio al plan
**Hobby** (5-oct-2026) Railway ya no enseña «créditos restantes»: esos eran los US$5 de la prueba gratis.

## Cómo cobra Railway en Hobby

- El plan cuesta **US$5 al mes** e incluye **US$5 de uso** de recursos (CPU, memoria, red, discos) de todos los
  proyectos y entornos del workspace (producción y staging juntos).
- Si en el periodo el uso pasa de US$5, Railway cobra la **diferencia a la tarjeta** al cierre del periodo (día de
  corte: el 5 de cada mes, a las 16:44 de Mazatlán). Ejemplo: uso de US$12 → factura de US$12 (US$5 del plan +
  US$7 de diferencia). Railway también puede cobrar una parte antes del corte si el uso sube mucho («partial amount
  … earlier in the billing cycle», docs de Railway).
- **Pasar de US$5 no apaga nada.** Los servicios solo se detienen si:
  1. hay un **límite duro** de uso configurado (Workspace › Usage › Usage Limits) y se alcanza. Al 7-oct-2026 la
     cuenta NO tiene límite (`usageLimit: null`); el **límite suave** solo manda correo, no apaga;
  2. la **tarjeta rechaza** el cobro y la factura queda vencida: según el foro de Railway, en Hobby hay pocos días de
     gracia antes de detener todo, y al pagar hay que volver a suscribirse a Hobby;
  3. se cancela el plan.

## Cómo funciona en el CRM

- El **worker** lee cada 5 min (y al arrancar) una sola consulta GraphQL a `https://backboard.railway.com/graphql/v2`:
  `project(id: RAILWAY_PROJECT_ID) { workspace { plan customer { currentUsage state billingPeriod subscriptions } } }`
  (`lib/railway-billing/read.ts`, `sync.ts`). Solo lee: no cambia nada ni cuesta nada.
- Guarda la última lectura buena en `railway_billing` (migración 0063; una fila por organización): plan, estado del
  cobro, periodo, uso en dólares y lo que va de la próxima factura. Si Railway falla se guarda el error (sin el
  token) y se conserva lo anterior.
- El **Dashboard** muestra la tarjeta **Railway (servidores del CRM)** debajo del Gasto de IA (mismos permisos;
  `lib/dashboard/railway.ts`, `app/(app)/inicio/_components/railway-card.tsx`): uso del periodo, lo que queda de lo
  incluido en el plan (barra naranja desde 80 %) y la **factura estimada** = máx(lo que cuesta el plan, uso
  proyectado al cierre a ritmo lineal). El primer día del periodo no se estima. Sin fila (sin token) no hay tarjeta.
- `currentUsage` lo da Railway en caché y puede venir unos minutos atrasado. No incluye impuestos.
- Datos de referencia (7-oct-2026, 1.8 días del periodo): uso US$0.69, próxima factura US$5.02 (plan + 2 centavos
  del cambio de plan), estimada ≈ US$11.85.

## Variables (solo en el worker)

- `RAILWAY_BILLING_TOKEN`: token del **workspace** «diluvium-mx's Projects» (Railway › Account Settings › Tokens ›
  elegir el workspace). Railway no tiene tokens de solo lectura: este da control del workspace (podría borrar
  servicios), por eso va solo en el worker, nunca en la web ni en el repo, y el CRM solo hace la consulta de arriba.
  Va en el encabezado `Authorization`. Si el token del workspace no alcanzara a leer el cobro, el error lo dice
  («no devolvió el cobro del workspace») y habría que decidir con el dueño si usar uno de cuenta.
- `RAILWAY_PROJECT_ID`: la pone Railway sola en cada servicio; no hay que cargarla.

Carga: primero `worker` de staging para probar; después `worker-production` y se borra de staging (como las llaves
de administración de IA). `railway variable delete` no redespliega: redesplegar.
