"use client";

// Etapas del Embudo VIVAS para toda la UI (Columnas del Embudo, 26-sep-2026). El
// layout las carga del servidor y este contexto las mantiene al día: con cada
// `stages.updated` del SSE (alguien renombró, agregó, reordenó o borró una columna
// en otra sesión) se vuelven a pedir. Toda pantalla que muestra o elige etapas
// (Embudo, Detalle, chat, avisos, Automatización, editor) lee de aquí.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getFunnelStages } from "@/lib/actions/funnel-stages";
import { sortStages, stageByKey, type FunnelStage } from "@/lib/contacts/stages";
import type { StagesUpdatedEvent } from "@/lib/inbox/types";
import { useInboxStream } from "../dashboard/_components/use-inbox-stream";

type Ctx = {
  stages: FunnelStage[];
  /** Nombre para mostrar (la clave si ya no existe). */
  labelOf: (key: string) => string;
  colorOf: (key: string) => string;
  /** Vuelve a pedir las etapas al servidor (tras guardar en el editor). */
  refresh: () => Promise<void>;
  /** Pone en el contexto las etapas que devolvió una acción (sin esperar al SSE). */
  apply: (stages: FunnelStage[]) => void;
  /** Último `stages.updated` recibido (para que el Embudo se ponga al día). */
  lastEvent: StagesUpdatedEvent | null;
};

const FunnelStagesContext = createContext<Ctx | null>(null);

export function FunnelStagesProvider({ initial, children }: { initial: FunnelStage[]; children: React.ReactNode }) {
  const [stages, setStages] = useState<FunnelStage[]>(() => sortStages(initial));
  const [lastEvent, setLastEvent] = useState<StagesUpdatedEvent | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const fresh = await getFunnelStages();
      if (alive.current) setStages(sortStages(fresh));
    } catch {
      // Sin red: se queda con lo que hay; el siguiente evento o navegación lo repone.
    }
  }, []);

  useInboxStream((event) => {
    if (event.type === "stages.updated") {
      setLastEvent(event);
      void refresh();
    }
    // Reconexión (laptop suspendida, red caída): pudo perderse un stages.updated; se
    // releen las etapas (si no, las tarjetas de una columna nueva no tendrían dónde ir).
    if (event.type === "reload") void refresh();
  });

  const value = useMemo<Ctx>(
    () => ({
      stages,
      labelOf: (key) => stageByKey(stages, key)?.name ?? key,
      colorOf: (key) => stageByKey(stages, key)?.color ?? "#64748B",
      refresh,
      apply: (next) => setStages(sortStages(next)),
      lastEvent,
    }),
    [stages, refresh, lastEvent],
  );
  return <FunnelStagesContext.Provider value={value}>{children}</FunnelStagesContext.Provider>;
}

export function useFunnelStages(): Ctx {
  const ctx = useContext(FunnelStagesContext);
  if (!ctx) throw new Error("useFunnelStages debe usarse dentro de FunnelStagesProvider (layout de la app).");
  return ctx;
}
