// Reglas PURAS de cuándo y cómo se guarda el costo del CRM de un mes cerrado (crm_cost_months; lib/costos/guardar-mes.ts
// las usa en el worker). Aparte para poder probarlas sin base.
export type CostoMes = { iaUsd: number | null; metaUsd: number | null; railwayUsd: number | null; zernioUsd: number | null };

// Hasta qué día del mes siguiente (hora de Mazatlán) se vuelve a guardar el mes anterior.
export const DIAS_PARA_CERRAR = 7;

const ZONA = "America/Mazatlan";

function diaDelMes(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: ZONA, day: "numeric" }).format(now));
}

// PURO: ¿se vuelve a guardar el mes? Siempre si aún no hay fila; nunca si se cargó a mano; si no, solo los
// primeros DIAS_PARA_CERRAR días del mes siguiente.
export function debeGuardar(fila: { source: string } | null, now: Date): boolean {
  if (!fila) return true;
  if (fila.source === "manual") return false;
  return diaDelMes(now) <= DIAS_PARA_CERRAR;
}

// PURO: lo nuevo manda; si un servicio ya no se puede leer (null), se queda lo que se guardó antes.
export function combinar(anterior: CostoMes | null, nuevo: CostoMes): CostoMes {
  return {
    iaUsd: nuevo.iaUsd ?? anterior?.iaUsd ?? null,
    metaUsd: nuevo.metaUsd ?? anterior?.metaUsd ?? null,
    railwayUsd: nuevo.railwayUsd ?? anterior?.railwayUsd ?? null,
    zernioUsd: nuevo.zernioUsd ?? anterior?.zernioUsd ?? null,
  };
}
