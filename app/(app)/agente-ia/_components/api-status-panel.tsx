// Panel compacto "APIs de IA" (sección Modelo, solo owner/admin): cada proveedor en
// uno de tres estados — "Conectada", "Falta la llave en Railway" (con el nombre de
// su variable) o "Falta soporte en el CRM" —, agrupados por estado para que quepa
// en pocas líneas. Solo sabe si la variable EXISTE; nunca ve su valor. Sin lógica
// de datos: recibe el estado calculado en el servidor.
import type { ProviderApiState, ProviderApiView } from "@/lib/agente-ia/types";

const STATES: { state: ProviderApiState; label: string; dot: string }[] = [
  { state: "conectada", label: "Conectada", dot: "bg-brand-navy dark:bg-[#6fa3dc]" },
  { state: "falta_llave", label: "Falta la llave en Railway", dot: "bg-brand-orange" },
  { state: "falta_soporte", label: "Falta soporte en el CRM (llega con la parte (c) de Fase D)", dot: "bg-muted-foreground/40" },
];

export function ApiStatusPanel({ providers }: { providers: ProviderApiView[] }) {
  return (
    <div className="rounded-md border border-black/10 p-3 dark:border-white/10">
      <h3 className="text-xs font-semibold text-foreground">APIs de IA</h3>
      <ul className="mt-1.5 flex flex-col gap-1 text-xs">
        {STATES.map(({ state, label, dot }) => {
          const group = providers.filter((p) => p.state === state);
          if (group.length === 0) return null;
          return (
            <li key={state} className="flex items-baseline gap-1.5">
              <span aria-hidden="true" className={`inline-block size-1.5 shrink-0 -translate-y-px rounded-full ${dot}`} />
              <span className={state === "falta_soporte" ? "text-muted-foreground" : "text-foreground"}>
                {label}:{" "}
                {group.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ", "}
                    <span className="font-medium text-foreground">{p.label}</span>
                    {state === "falta_llave" && (
                      <>
                        {" "}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{p.envKey}</code>
                      </>
                    )}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
