# Tabla de anuncios — contrato de la interfaz

Componente de **solo presentación**: `components/anuncios/ads-table.tsx` (`AdsTable`). No lee la
base; recibe filas `AdRow` y las pinta. Los datos los conecta el bloque **Anuncios de Meta**
(`lib/ads/*`). Vista previa con datos de ejemplo: `/vista-previa/anuncios` (owner/admin, solo
fuera de producción; se borra al conectar datos reales). Cuando Anuncios esté en `main`, con luz
verde del dueño, esta tabla **reemplaza la lista de `/anuncios`**.

## `AdRow` (exportado desde `components/anuncios/ads-table.tsx`)

| Campo | Tipo | Qué es |
|---|---|---|
| `adKey` | `string` | Llave interna del anuncio; la fila lleva a `/anuncios/[adKey]`. |
| `adId` | `string` | Id del anuncio en Meta. |
| `name` | `string` | Nombre del anuncio. |
| `thumbnailUrl` | `string \| null` | Miniatura (40 px); `null` → marcador gris. |
| `metaUrl` | `string \| null` | Enlace al anuncio en Meta (ícono ↗, pestaña nueva); `null` → sin ícono. |
| `campaignName` | `string` | Campaña. |
| `adsetName` | `string` | Conjunto de anuncios (debajo, en gris). |
| `status` | `"active" \| "paused" \| "unknown"` | Punto de estado ● Activa / Pausada / Sin estado. |
| `linkClicks` | `number \| null` | Clics en el enlace. `null` → "—" con aviso "Llega con Métricas de anuncios". |
| `clients` | `number` | Clientes que escribieron por WhatsApp desde el anuncio. |
| `bought` | `number` | De esos, los que llegaron a la etapa **Compra**. |

Derivado en la tabla: **Conversión** = `bought ÷ clients` (en %; "—" si `clients` es 0).

## Props de `AdsTable`

- `rows: AdRow[]` — obligatorio.
- `loading?: boolean` — muestra "Cargando anuncios…".
- `emptyMessage?: string` — texto cuando `rows` está vacío.
- `className?: string` — el **alto lo pone el padre** (p. ej. `min-h-0 flex-1` dentro de un
  contenedor con alto fijo): la tabla se desliza por dentro y la página nunca.

## Comportamiento que ya trae la tabla

- **Buscador** por anuncio, campaña o conjunto, sin acentos ni mayúsculas (`lib/text/search.ts`).
- **Filtro** Activas / Todas (por defecto Activas).
- **Orden** al dar clic en cualquier encabezado (flecha de dirección); por defecto Clientes ↓.
  Los `null` van siempre al final.
- Encabezado fijo; números a la derecha con `tabular-nums`; fila con estilo de tarjeta-enlace
  (`data-link="card"`, flecha › que avanza al pasar el cursor).
- Estados: vacío, cargando y "sin resultados".
- **Virtualizada** con `@tanstack/react-virtual` cuando pasa de 100 filas.

## Periodo

El filtro de periodo es el del Dashboard (`app/(app)/inicio/_components/range-filter.tsx`), con
atajos **Hoy · 7 días · 30 días · Este mes** y `basePath` para la página que recibe
`?mes=` o `?desde=&hasta=`. El periodo lo aplica quien arma las filas (servidor): la tabla no filtra por fecha.

## Qué le toca al bloque de Anuncios

1. Armar `AdRow[]` para el periodo (clientes = contactos con clic del anuncio en el periodo;
   compraron = de esos, los que hoy están en etapa `compra`; `linkClicks` queda `null` hasta
   Métricas de anuncios).
2. Reemplazar la lista de `/anuncios` por `<AdsTable rows={…} />` dentro de un contenedor con alto
   fijo, y borrar `/vista-previa/anuncios`.
