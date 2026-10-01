# Gasto de IA: ¿saldo por API o solo gasto? (22-sep-2026)

> **Actualización 1-oct-2026 — implementado (rama feat/gasto-ia-real, migración 0054).** El Dashboard ya
> no estima: lee el cobro real de cada proveedor. Ver la sección **"Implementado (1-oct-2026)"** al final.

Investigación para la tarjeta "Gasto de IA" del Dashboard (A2). **No implementado**: la tarjeta es un
placeholder hasta que la Fase B persista `ai_usage`.

## Conclusión

**Ninguno de los dos proveedores expone el saldo prepagado restante por una API oficial. Los dos
exponen el GASTO.** Diseño viable:

> **Saldo estimado = crédito cargado (lo captura el owner a mano) − gasto**

El gasto sale de dos lugares: nuestro propio registro de tokens (`ai_usage`, que es casi en vivo) o
la Cost API de cada proveedor (oficial, diaria, sin impuestos). Se muestra siempre como "estimado".

| Proveedor | ¿Saldo por API? | ¿Gasto por API? |
|---|---|---|
| OpenAI | **No**: la referencia Admin > Organization no tiene recurso de créditos o saldo. `spend_limit`/`spend_alerts` son topes, no saldo [1][2] | **Sí**: `GET /v1/organization/costs` (USD, buckets de 1 día, `group_by` por `project_id`/`line_item`/`api_key_id`) [1]; tokens en `GET /v1/organization/usage/completions` [3] |
| Anthropic | **No**: el Admin API no tiene endpoints de billing ni de créditos; el saldo solo se ve en Console > Billing [7][8] | **Sí**: `GET /v1/organizations/cost_report` (USD como string decimal en **centavos**, buckets de 1 día, máximo 31) [9]; tokens en `GET /v1/organizations/usage_report/messages` [10] |

## Requisitos y matices

- **Llaves de administración** (distintas de las de inferencia). OpenAI: *Admin API key*; solo la
  crea un Organization Owner [2][4]. Anthropic: `sk-ant-admin01-…`; solo la crea un admin, y el
  Admin API **no existe para cuentas individuales**: la cuenta debe estar configurada como
  organización [10][11].
- **No usar** `/v1/dashboard/billing/credit_grants` de OpenAI: no está documentado; es del sitio
  web (sesión del navegador + anti-bot) [5]. Fuente no oficial (foro), citada solo para descartarlo.
- **Retraso**: Anthropic, normalmente menos de 5 min; se puede consultar una vez por minuto [10].
  OpenAI costs: granularidad diaria [1].
- **Impuestos**: ninguna Cost API los menciona; el owner debe capturar el crédito **neto**, no
  el cargo con IVA.
- **Vencimiento**: en los dos proveedores los créditos prepagados vencen al año [6][8].
- **Auto-reload**: si está prendido, cada recarga se tiene que capturar a mano, o la estimación
  se descuadra [8].
- Anthropic: el cost report no incluye Priority Tier [10].

## Propuesta para cuando exista `ai_usage` (Fase E)

1. Tabla `ai_credit_loads` (org, proveedor, monto USD, fecha, nota, capturado_por). Solo
   owner/admin.
2. Gasto del periodo = suma de `ai_usage` × tabla de precios (en vivo). Opcional: conciliación
   diaria contra la Cost API, con la llave admin guardada solo en Railway.
3. Tarjeta: gasto del mes por proveedor + "saldo estimado" = cargas − gasto desde la primera carga.

## Fuentes

1. https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs
2. https://developers.openai.com/api/docs/guides/admin-apis
3. https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions
4. https://help.openai.com/en/articles/9687866-admin-and-audit-logs-api-for-the-api-platform
5. https://community.openai.com/t/issue-in-fetching-openai-api-usage-billing-cost-and-credit-balance-programmatically-for-backend-monitoring/1379947 (foro, no oficial)
6. https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing
7. https://platform.claude.com/docs/en/api/admin
8. https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage
9. https://platform.claude.com/docs/en/api/beta/organization/cost_report/retrieve
10. https://platform.claude.com/docs/en/manage-claude/usage-cost-api
11. https://platform.claude.com/docs/en/manage-claude/admin-api-keys


## Implementado (1-oct-2026)

Por qué: el 29-sep el Dashboard decía US$3.65 de Anthropic y la consola US$5.90. El cálculo del CRM era
exacto (106 llamadas recalculadas a mano = US$3.6457); la diferencia era gasto de la **misma llave** fuera
de la base de producción (staging, bancos de pruebas desde la Mac, pruebas de desarrollo del 26-sep).

**Cómo se lee cada proveedor** (worker, cada 5 min, `lib/ai/billing/*`; tabla `ai_provider_billing`):

| Proveedor | Variables (solo worker) | Gasto | Saldo |
|---|---|---|---|
| Anthropic | `ANTHROPIC_ADMIN_KEY` (la cuenta se convirtió a organización Team) | Días de antes de ayer: `cost_report` (dólares). Ayer: `usage_report` por hora; hoy: por minuto, a precio oficial | Recargas registradas − gasto real |
| OpenAI | `OPENAI_ADMIN_KEY` | `/v1/organization/costs` por día (incluye hoy) | Recargas registradas − gasto real |
| xAI | `XAI_MANAGEMENT_KEY` (Billing: Read only) + `XAI_TEAM_ID` | Movimientos `SPEND` del saldo prepagado | Directo (−`total`; compras negativas) |
| OpenRouter | `OPENROUTER_MANAGEMENT_KEY` | `/api/v1/activity` (30 días completos) | Directo (`total_credits − total_usage`) |
| Google | — | Registro del CRM | Estimado (recargas − registro del CRM) |

Lo que se midió contra la API (1-oct-2026):
- El `cost_report` de Anthropic **no trae el día en curso** (a las 16:45 UTC no había nada del 1-oct) y el
  de ayer **sigue creciendo** horas después de medianoche (30-sep: de US$3.17 a US$3.29). Por eso ayer y hoy
  van por tokens.
- `usage_report` en bloques de **1 hora y 1 día** solo trae bloques completos; en bloques de **1 minuto**
  llega casi al momento. Tokens × precio oficial = lo que registró el CRM: 00:00–15:59 UTC del 1-oct,
  US$1.1479 contra US$1.1481.
- Leer reportes **no gasta tokens ni saldo**.

Reglas del Dashboard (`lib/dashboard/ai-spend.ts`):
- Gasto de cada día UTC = lo que reporta el proveedor, **nunca menos** de lo que registró el CRM ese día
  (cubre los minutos que el proveedor aún no reporta).
- **En producción / Pruebas:** en Anthropic, desde el 1-oct-2026 (`ANTHROPIC_PRUEBAS_DESDE`), producción =
  espacio de trabajo **Default** (llave "CRM Diluvium", la de producción) y pruebas = espacio **«Pruebas»**
  (llave de staging; tope de US$10 al mes). Antes de esa fecha, y en los demás proveedores, producción =
  registro del CRM y pruebas = lo que cobró el proveedor menos eso.
- Verificación diaria en el log del worker: si Anthropic cobró en producción distinto de lo que calculó el
  CRM (más de US$0.02 y 3 %), avisa "revisar precios".
- xAI: el saldo nunca se muestra mayor que lo comprado − lo ya registrado (un tercero dice que xAI
  descuenta con retraso; sin confirmar).
- Lo único que puede descuadrar Anthropic y OpenAI son las **recargas registradas** (monto en créditos,
  sin IVA, todas; con recarga automática, cada una).
