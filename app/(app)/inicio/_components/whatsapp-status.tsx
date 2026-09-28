"use client";

// Pastillas del Dashboard, chicas, arriba y para todos los roles:
// - "WhatsApp" (alarma de desconexión): número, último mensaje de un cliente,
//   worker y webhook de Zernio (lib/monitoring/status-pill.ts).
// - "Bot" (Bloque C): canal Encendido/Apagado, horario, conversaciones sin
//   respuesta y última respuesta del bot (lib/monitoring/bot-status.ts).
// Solo pintan lo que calculó el servidor. Colores discretos: el naranja solo
// para "revisar"/"fuera de horario" (alerta) y el rojo para lo que está roto.
import { Popover } from "@base-ui/react/popover";
import type { PillStatus, PillTone, StatusLine } from "@/lib/monitoring/status-pill";

const DOT: Record<PillTone | "neutral", string> = {
  green: "bg-emerald-500",
  amber: "bg-brand-orange",
  red: "bg-destructive",
  gray: "bg-muted-foreground/50",
  neutral: "bg-muted-foreground/30",
};

const PILL: Record<PillTone, string> = {
  green: "border-border text-foreground",
  amber: "border-brand-orange/50 text-foreground",
  red: "border-destructive/40 bg-destructive/5 text-destructive font-medium",
  gray: "border-border text-muted-foreground",
};

function Dot({ tone }: { tone: PillTone | "neutral" }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${DOT[tone]}`} />;
}

function Line({ line }: { line: StatusLine }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5">
        <Dot tone={line.tone} />
      </span>
      <span>
        <span className="text-muted-foreground">{line.label}: </span>
        <span className={line.tone === "red" ? "font-medium text-destructive" : undefined}>{line.value}</span>
      </span>
    </li>
  );
}

export function StatusPill({ status, title }: { status: PillStatus; title: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${PILL[status.tone]}`}
        aria-label={`${status.label}. Ver detalle`}
      >
        <Dot tone={status.tone} />
        {status.label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Popover.Popup className="w-72 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md outline-none">
            <Popover.Title className="mb-2 text-sm font-semibold">{title}</Popover.Title>
            <ul className="space-y-1.5">
              {status.lines.map((line) => (
                <Line key={line.label} line={line} />
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
