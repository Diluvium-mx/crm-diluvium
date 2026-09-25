// Panel compacto "APIs de IA" (sección Modelo, solo owner/admin): por proveedor,
// "Conectada", "Falta la llave en Railway" con el nombre de su variable, o "Falta
// soporte en el CRM". Solo sabe si la variable EXISTE; nunca ve su valor. Sin
// lógica de datos: recibe el estado calculado en el servidor.
import type { ProviderApiState, ProviderApiView } from "@/lib/agente-ia/types";

const DOT: Record<ProviderApiState, string> = {
  conectada: "bg-brand-navy dark:bg-[#6fa3dc]",
  falta_llave: "bg-brand-orange",
  falta_soporte: "bg-muted-foreground/40",
};

function StateText({ p }: { p: ProviderApiView }) {
  switch (p.state) {
    case "conectada":
      return <span className="text-foreground">Conectada</span>;
    case "falta_llave":
      return (
        <span className="text-foreground">
          Falta la llave en Railway: <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{p.envKey}</code>
        </span>
      );
    case "falta_soporte":
      return <span className="text-muted-foreground">Falta soporte en el CRM (llega con la parte (c) de Fase D)</span>;
  }
}

export function ApiStatusPanel({ providers }: { providers: ProviderApiView[] }) {
  return (
    <div className="rounded-md border border-black/10 p-3 dark:border-white/10">
      <h3 className="text-xs font-semibold text-foreground">APIs de IA</h3>
      <ul className="mt-2 grid gap-x-6 gap-y-1.5 lg:grid-cols-2">
        {providers.map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="flex w-24 shrink-0 items-center gap-1.5 font-medium text-foreground">
              <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${DOT[p.state]}`} />
              {p.label}
            </span>
            <StateText p={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}
