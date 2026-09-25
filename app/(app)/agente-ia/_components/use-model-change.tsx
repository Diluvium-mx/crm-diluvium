"use client";

// Cambio de modelo con confirmación, reutilizable para cualquier selector de modelo
// (hoy el cerebro; con la parte (c) de Fase D, Modelo 1 y Modelo 2): al elegir una
// opción NO se guarda; aparece el pop-up de arriba ("¿Cambiar el cerebro de Ángela
// de Claude Sonnet 5 a GPT-5.6 Terra? …") y el cambio se guarda SOLO con "Sí,
// cambiar". Después, en el mismo lugar y por 3 s: "Listo: Ángela ahora usa …".
// Sin lógica de datos: guarda con la Server Action que recibe (`save`).
import { useEffect, useState, useTransition } from "react";
import { TopConfirm, TopNotice } from "@/components/ui/top-confirm";
import { costPer100Label } from "@/lib/agente-ia/model-cost";
import type { AgentActionResult, ModelOptionView } from "@/lib/agente-ia/types";

const DONE_MS = 3_000;

// "costo sin dato" → "Costo sin dato." (va después de otra oración).
function sentence(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export function modelChangeQuestion(p: { target: string; agentName: string; from: string; to: string }): string {
  return `¿Cambiar ${p.target} de ${p.agentName} de ${p.from} a ${p.to}?`;
}

export function useModelChange({
  agentName,
  target,
  options,
  value,
  save,
}: {
  agentName: string;
  // "el cerebro", "el Modelo 1"…
  target: string;
  options: readonly ModelOptionView[];
  value: string;
  save: (modelId: string) => Promise<AgentActionResult>;
}) {
  const [selected, setSelected] = useState(value);
  const [asking, setAsking] = useState<ModelOptionView | null>(null);
  const [done, setDone] = useState<{ label: string; key: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  function request(option: ModelOptionView) {
    if (!option.available || option.id === selected || pending) return;
    setError(null);
    setDone(null);
    setAsking(option);
  }

  function confirm() {
    const option = asking;
    if (!option) return;
    start(async () => {
      let r: AgentActionResult;
      try {
        r = await save(option.id);
      } catch {
        r = { ok: false, message: "No se pudo cambiar el modelo." };
      }
      // Después del await, las actualizaciones van en su propia transición (React
      // 19): así el pop-up se cierra en el mismo render en que termina "pending".
      start(() => {
        setAsking(null);
        if (r.ok) {
          setSelected(option.id);
          setDone({ label: option.label, key: Date.now() });
        } else {
          setError(r.message);
        }
      });
    });
  }

  const fromLabel = options.find((o) => o.id === selected)?.label ?? selected;
  const ui = (
    <>
      {asking && (
        <TopConfirm
          key={asking.id}
          title={modelChangeQuestion({ target, agentName, from: fromLabel, to: asking.label })}
          confirmLabel="Sí, cambiar"
          pendingLabel="Cambiando…"
          pending={pending}
          onConfirm={confirm}
          onCancel={() => setAsking(null)}
        >
          Contestará con el nuevo modelo desde el siguiente mensaje.{" "}
          <span title="aproximado, sin impuestos">{sentence(costPer100Label(asking.costPer100Usd))}</span>
        </TopConfirm>
      )}
      <TopNotice message={!asking && done ? `Listo: ${agentName} ahora usa ${done.label}` : null} />
    </>
  );

  return { selected, pending, error, request, ui };
}
