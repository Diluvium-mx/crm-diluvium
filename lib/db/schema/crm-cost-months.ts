import { numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

// Costo del CRM por mes cerrado (20-nov-2026, pedido del dueño: «el monto mensual y total del mantenimiento del CRM»
// en el Dashboard). Railway y Zernio solo guardan su periodo actual (y Zernio el anterior), así que el total desde que
// arrancó el CRM se perdería: el worker guarda aquí, cada hora durante los primeros días del mes, lo que costó el mes
// anterior con las mismas reglas del correo del día 3 (lib/costos/mes.ts) y después lo deja fijo. Los meses de antes
// de esta tabla (septiembre y octubre de 2026) se cargan una vez a mano (`source = 'manual'`) y el worker no los toca.
// Cada servicio en dólares sin impuestos; null = sin dato ese mes (no suma). Detalle: docs/costos.md › Dashboard.
export const crmCostMonths = pgTable(
  "crm_cost_months",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // "2026-10"
    month: text("month").notNull(),
    iaUsd: numeric("ia_usd", { precision: 14, scale: 6, mode: "number" }),
    metaUsd: numeric("meta_usd", { precision: 14, scale: 6, mode: "number" }),
    railwayUsd: numeric("railway_usd", { precision: 14, scale: 6, mode: "number" }),
    zernioUsd: numeric("zernio_usd", { precision: 14, scale: 6, mode: "number" }),
    // 'auto' = lo guarda el worker; 'manual' = cargado a mano (meses de antes de la tabla); el worker no lo cambia.
    source: text("source").notNull().default("auto"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.month] })],
);
