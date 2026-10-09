"use client";

// Seguimiento del Agente IA en el composer (docs/seguimientos.md §8, decisión del dueño del
// 2-oct-2026): una píldora 🤖 que RELLENA el hueco blanco de la barra arriba de ⚡ 📄 📎 (la caja
// de texto mide dos renglones y los iconos uno), sin agrandar la barra. Solo aparece cuando el
// chat tiene un seguimiento. Al tocarla se abre la burbuja arriba del composer (como Mensajes
// rápidos) con qué quedó pendiente, a qué hora sale, por dónde y Ver mensaje · Cambiar hora ·
// Lo mando yo · Cancelar (y "Que salga solo" en una sugerencia).
// Parte 1 = MODO ENSAYO: la píldora gris punteada dice "Ensayo"; nada sale al cliente.
// Caritas (6-oct-2026, decisión del dueño): robot normal = programado; dormido = suspendido (pausa
// puesta a mano: no sale solo); ojos en X = cancelado en este chat (se queda así hasta «Reactivar»)
// o, en rojo, el cliente se dio de baja de las promociones (aviso que se abre solo una vez).
// Ventana (6-oct-2026, decisión del dueño): arriba el estado junto a la ✕ roja (sin la palabra «Cerrar»,
// como el visor de archivos) y la carita según el estado; en el cuerpo, preguntas cortas (¿Dónde se quedó el
// chat? · ¿Qué busca el seguimiento? · ¿Cuándo sale el N.º mensaje?), «Ver mensaje» con el texto exacto y un
// renglón por mensaje que ya salió. Sin «Por dónde» ni la palabra «plantilla». El texto de la píldora, los
// títulos, las preguntas y los botones no se seleccionan; las respuestas y el mensaje sí (para copiarlos).
// Siempre está (7-oct-2026, decisión del dueño): sin nada que seguir sale el robot dormido en gris («dormido») y su
// ventana dice por qué; «esperando» se queda mientras el último mensaje sea nuestro aunque ya no queden intentos.
// Consultas: al abrir el chat, con cada aviso "followup.updated" de este chat y al volver a la pestaña.
// Escenas (9-oct-2026, prototipos aprobados por el dueño): cuando la píldora cambia con el chat abierto juega una
// animación corta (disparo, reparación, reloj, despertador, avioncito; robot-escena-cuando.ts y robot-escena.tsx). Lo
// ve todo el que tenga el chat abierto, vendedor o admin, lo haya hecho él u otro.
import { useCallback, useEffect, useRef, useState } from "react";
import { apagarSeguimientos, approveSuggestedFollowUp, cancelFollowUp, getFollowUp, quitarSinSeguimientos, reactivarSeguimientos, rescheduleFollowUp } from "@/lib/actions/seguimientos";
import type { FollowUpDormido, FollowUpOff, FollowUpState, FollowUpView } from "@/lib/followups/view";
import { followUpText } from "@/lib/followups/message";
import { whatsappWebLink } from "@/lib/contacts/whatsapp-link";
import { instantToLocal, SCHEDULE_TIME_ZONE } from "@/lib/scheduled/rules";
import { CloseX } from "@/components/ui/close-x";
import { useInboxStream } from "./use-inbox-stream";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { EtiquetaEscena, RobotEscena } from "./robot-escena";
import { elegirEscena, ESCENA_MS, ESCENA_TONO_MS, type Escena, type FotoPildora, type RobotFace } from "./robot-escena-cuando";

// ── Datos ────────────────────────────────────────────────────────────────────

export function useFollowUp(conversationId: string): { followUp: FollowUpState | null; reload: () => void } {
  const [followUp, setFollowUp] = useState<FollowUpState | null>(null);
  const seq = useRef(0);
  const [seen, setSeen] = useState(conversationId);
  if (seen !== conversationId) {
    setSeen(conversationId);
    setFollowUp(null);
  }
  const reload = useCallback(() => {
    const mine = ++seq.current;
    void getFollowUp(conversationId).then((view) => {
      if (mine === seq.current) setFollowUp(view);
    });
  }, [conversationId]);

  useEffect(() => {
    reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  useInboxStream((event) => {
    if (event.type === "reload") reload();
    else if (event.type === "followup.updated" && event.conversationId === conversationId) reload();
  });
  return { followUp, reload };
}

// ── Formato ──────────────────────────────────────────────────────────────────

const dayKey = (d: Date, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hourOf = (d: Date, zone: string) => new Intl.DateTimeFormat("es-MX", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const weekdayOf = (d: Date, zone: string) => new Intl.DateTimeFormat("es-MX", { timeZone: zone, weekday: "short" }).format(d).replace(".", "");

/** "20:00" (hoy) · "mañana 10:00" · "sáb 10:00" · "12 oct 10:00" (más de una semana). */
export function whenLabel(iso: string, zone: string = SCHEDULE_TIME_ZONE, now: Date = new Date()): string {
  const d = new Date(iso);
  const today = dayKey(now, zone);
  const tomorrow = dayKey(new Date(now.getTime() + 24 * 60 * 60_000), zone);
  const day = dayKey(d, zone);
  const hour = hourOf(d, zone);
  if (day === today) return hour;
  if (day === tomorrow) return `mañana ${hour}`;
  if (d.getTime() - now.getTime() < 6 * 24 * 60 * 60_000) return `${weekdayOf(d, zone)} ${hour}`;
  const date = new Intl.DateTimeFormat("es-MX", { timeZone: zone, day: "numeric", month: "short" }).format(d).replace(".", "");
  return `${date} ${hour}`;
}

/** Para la ventana: "hoy 20:00" · "mañana 10:00" · "lun 13 oct, 18:00". */
export function dateLabel(iso: string, zone: string = SCHEDULE_TIME_ZONE, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = dayKey(d, zone);
  const hour = hourOf(d, zone);
  if (day === dayKey(now, zone)) return `hoy ${hour}`;
  if (day === dayKey(new Date(now.getTime() + 24 * 60 * 60_000), zone)) return `mañana ${hour}`;
  if (day === dayKey(new Date(now.getTime() - 24 * 60 * 60_000), zone)) return `ayer ${hour}`;
  const date = new Intl.DateTimeFormat("es-MX", { timeZone: zone, day: "numeric", month: "short" }).format(d).replace(".", "");
  return `${weekdayOf(d, zone)} ${date}, ${hour}`;
}

/** "hoy 17:15" · "el mar 13 oct, 18:00" (con artículo solo cuando es una fecha). */
function onDate(iso: string): string {
  const label = dateLabel(iso);
  return /^(hoy|mañana|ayer) /.test(label) ? label : `el ${label}`;
}

/** "antes de hoy 20:00" · "antes del mar 13 oct, 18:00". */
function beforeDate(iso: string): string {
  const label = dateLabel(iso);
  return /^(hoy|mañana|ayer) /.test(label) ? `antes de ${label}` : `antes del ${label}`;
}

/** "1.er" · "2.º" · "3.er" (mensaje). */
export function ordinal(n: number): string {
  return n === 1 || n === 3 ? `${n}.er` : `${n}.º`;
}

const ZONE_NAMES: Readonly<Record<string, string>> = {
  "America/Mexico_City": "centro",
  "America/Mazatlan": "Mazatlán",
  "America/Tijuana": "Tijuana",
  "America/Hermosillo": "Sonora",
  "America/Chihuahua": "Chihuahua",
  "America/Ciudad_Juarez": "Cd. Juárez",
  "America/Cancun": "Cancún",
};

function pillPrefix(f: FollowUpView): string {
  return f.ensayo ? "Ensayo" : f.modo === "sugerido" && !f.autoAprobado ? "Suspendido" : "Seguimiento";
}

// Corto: la píldora mide lo mismo que ⚡ 📄 📎 (6-oct-2026). Qué tipo es lo dicen la carita y el color;
// el texto completo va en el title.
function pillText(f: FollowUpView): string {
  if (f.status === "esperando") return "esperando";
  return f.dueAt ? whenLabel(f.dueAt) : pillPrefix(f);
}

const FACE_SRC: Record<RobotFace, string> = { normal: "/emoji/robot.svg", dormido: "/emoji/robot-dormido.svg", cancelado: "/emoji/robot-cancelado.svg" };

/** El robot del seguimiento (imagen propia: no existe emoji de robot con ojos en X ni dormido). */
export function RobotIcon({ face, size = 18 }: { face: RobotFace; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- SVG chico y estático de public/emoji
  return <img src={FACE_SRC[face]} width={size} height={size} alt="" aria-hidden="true" className="-my-0.5 shrink-0" draggable={false} />;
}

function faceOf(f: FollowUpState): RobotFace {
  if (f.estado === "dormido") return "dormido";
  if (f.estado !== "activo") return "cancelado";
  return f.modo === "sugerido" && !f.autoAprobado ? "dormido" : "normal";
}

function toneOf(f: FollowUpState): string {
  if (f.estado === "dormido") return "border-muted-foreground/40 bg-background text-muted-foreground";
  if (f.estado === "baja") return "border-red-600 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200";
  if (f.estado === "cancelado") return "border-muted-foreground/70 bg-background text-muted-foreground";
  if (f.ensayo) return "border-dashed border-muted-foreground/60 bg-muted text-muted-foreground";
  if (f.modo === "sugerido" && !f.autoAprobado) return "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200";
  return "border-brand-navy bg-brand-navy/10 text-brand-navy dark:text-sky-300";
}

// «Cancelado» y el robot dormido van sin palabra, solo la carita (7-oct-2026, pedido del dueño); su ventana lo explica.
function labelOf(f: FollowUpState): string | null {
  if (f.estado === "baja") return "Se dio de baja";
  return f.estado === "activo" ? pillText(f) : null;
}

function fotoDe(f: FollowUpState): FotoPildora {
  const base = { cara: faceOf(f), etiqueta: labelOf(f), tono: toneOf(f) };
  if (f.estado !== "activo") return { ...base, estado: f.estado, id: null, dueAt: null, enviados: 0, ultimoSalio: false };
  const ultimo = f.intentos.at(-1);
  return { ...base, estado: "activo", id: f.id, dueAt: f.dueAt, enviados: f.intentos.length, ultimoSalio: !!ultimo && !ultimo.error && !ultimo.ensayo };
}

type EscenaEnCurso = { escena: Escena; n: number; etiquetaAntes: string | null; tonoAntes: string | null };

/** La escena que toca jugar: solo cuando la píldora CAMBIA a la vista (al abrir el chat no se juega; al cambiar de
 * chat la píldora se vuelve a montar). Mientras corre conserva el color de antes hasta ESCENA_TONO_MS y se quita sola
 * al terminar. */
function useRobotEscena(foto: FotoPildora): EscenaEnCurso | null {
  const clave = JSON.stringify(foto);
  const [antes, setAntes] = useState({ clave, foto });
  const [enCurso, setEnCurso] = useState<EscenaEnCurso | null>(null);
  if (antes.clave !== clave) {
    setAntes({ clave, foto });
    const escena = elegirEscena(antes.foto, foto);
    if (escena) setEnCurso({ escena, n: (enCurso?.n ?? 0) + 1, etiquetaAntes: antes.foto.etiqueta, tonoAntes: ESCENA_TONO_MS[escena] ? antes.foto.tono : null });
    else if (antes.foto.estado !== foto.estado) setEnCurso(null);
  }
  const escena = enCurso?.escena;
  const n = enCurso?.n;
  useEffect(() => {
    if (!escena) return;
    const termina = window.setTimeout(() => setEnCurso((e) => (e?.n === n ? null : e)), ESCENA_MS[escena]);
    const tonoMs = ESCENA_TONO_MS[escena];
    const tono = tonoMs === undefined ? null : window.setTimeout(() => setEnCurso((e) => (e && e.n === n ? { ...e, tonoAntes: null } : e)), tonoMs);
    return () => {
      window.clearTimeout(termina);
      if (tono !== null) window.clearTimeout(tono);
    };
  }, [escena, n]);
  return enCurso;
}

// ── Píldora ──────────────────────────────────────────────────────────────────

export function FollowUpPill({ followUp, open, onToggle, className = "" }: { followUp: FollowUpState; open: boolean; onToggle: () => void; className?: string }) {
  const f = followUp;
  const enCurso = useRobotEscena(fotoDe(f));
  if (f.estado === "dormido") {
    const title = `Seguimiento del Agente IA · dormido: ${f.razon}`;
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={title}
        title={title}
        data-testid="followup-pill"
        data-estado="dormido"
        data-escena={enCurso?.escena}
        // px-6: sin palabra conserva su tamaño y el robot queda en medio (junto a «Enviar plantilla»); con la ventana
        // abierta la Caja le da el ancho de ⚡ 📄 📎 (min-w-full) y el margen no estorba.
        className={`h-5 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-full border px-6 text-[11px] leading-none whitespace-nowrap transition-colors select-none ${enCurso ? "overflow-hidden" : ""} ${toneOf(f)} ${open ? "ring-2 ring-brand-navy/30" : ""} ${className}`}
      >
        {/* Solo la carita (7-oct-2026, pedido del dueño): qué pasa lo dicen el robot dormido y su ventana. */}
        {enCurso ? <RobotEscena key={enCurso.n} escena={enCurso.escena} /> : <RobotIcon face="dormido" />}
      </button>
    );
  }
  const label = labelOf(f);
  const title =
    f.estado === "baja"
      ? "Seguimiento del Agente IA · el cliente se dio de baja de las promociones de WhatsApp"
      : f.estado === "cancelado"
        ? "Seguimientos cancelados en este chat · se reactivan desde aquí"
        : `Seguimiento del Agente IA · ${f.casoLabel} · ${pillPrefix(f)}${f.status === "esperando" ? " · esperando respuesta" : f.dueAt ? ` · ${whenLabel(f.dueAt)}` : ""}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={title}
      title={title}
      data-testid="followup-pill"
      data-estado={f.estado}
      data-escena={enCurso?.escena}
      // overflow-hidden mientras corre una escena: lo que entra (pistola, llave, despertador, avioncito) no se sale.
      className={`h-5 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-full border text-[11px] leading-none whitespace-nowrap transition-colors select-none ${label ? "px-2" : "px-6"} ${enCurso ? "overflow-hidden" : ""} ${enCurso?.tonoAntes ?? toneOf(f)} ${open ? "ring-2 ring-brand-navy/30" : ""} ${className}`}
    >
      {enCurso ? <RobotEscena key={enCurso.n} escena={enCurso.escena} /> : <RobotIcon face={faceOf(f)} />}
      {label && (enCurso ? <EtiquetaEscena key={enCurso.n} antes={enCurso.etiquetaAntes} ahora={label} /> : <span className="truncate">{label}</span>)}
    </button>
  );
}

// ── Aviso de «se dio de baja» (se abre solo una vez por contacto en esta computadora) ─────

const bajaKey = (contactId: string) => `seguimiento-baja-visto:${contactId}`;
export function bajaAlreadySeen(contactId: string): boolean {
  try {
    return window.localStorage.getItem(bajaKey(contactId)) === "1";
  } catch {
    return false;
  }
}
export function markBajaSeen(contactId: string): void {
  try {
    window.localStorage.setItem(bajaKey(contactId), "1");
  } catch {
    /* sin almacenamiento: se vuelve a abrir la próxima vez, no pasa nada */
  }
}

// ── Encabezado de la ventana: carita, título, estado y ✕ roja ────────────────

type Estado = { label: string; tone: string };

function estadoOf(f: FollowUpState): Estado {
  if (f.estado === "dormido") return { label: "Dormido", tone: "border-muted-foreground/40 bg-background text-muted-foreground" };
  if (f.estado === "baja") return { label: "Se dio de baja", tone: "border-red-600 bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" };
  if (f.estado === "cancelado") return { label: "Cancelado", tone: "border-muted-foreground/50 bg-muted text-muted-foreground" };
  if (f.ensayo) return { label: "Ensayo", tone: "border-dashed border-muted-foreground/60 bg-muted text-muted-foreground" };
  if (f.status === "esperando") return { label: "Esperando respuesta", tone: "border-brand-navy/40 bg-brand-navy/10 text-brand-navy dark:text-sky-300" };
  if (f.modo === "sugerido" && !f.autoAprobado) return { label: "Suspendido", tone: "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" };
  return { label: "Programado", tone: "border-brand-navy bg-brand-navy/10 text-brand-navy dark:text-sky-300" };
}

function PanelHeader({ followUp, title, onClose }: { followUp: FollowUpState; title: string; onClose: () => void }) {
  const estado = estadoOf(followUp);
  const red = followUp.estado === "baja";
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      {/* 30 px (7-oct-2026, pedido del dueño): cabe en el alto que ya da la ✕ roja (32 px); el encabezado no crece. */}
      <RobotIcon face={faceOf(followUp)} size={30} />
      <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${red ? "text-red-800 dark:text-red-200" : "text-brand-navy dark:text-sky-300"}`}>{title}</span>
      <span data-testid="followup-estado" className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${estado.tone}`}>
        {estado.label}
      </span>
      <CloseX always size="sm" label="Cerrar seguimiento" onClick={onClose} />
    </div>
  );
}

function OffPanel({ off, onClose, onChanged }: { off: FollowUpOff; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await action();
      if (!r.ok) setError(r.message);
      else {
        onChanged();
        onClose();
      }
    } catch {
      setError("No se pudo guardar. Inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  };
  const button = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50";
  const baja = off.estado === "baja";
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      data-testid="followup-panel"
      className={`mb-2 overflow-hidden rounded-lg border text-sm shadow-md select-none ${baja ? "border-red-400 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-100" : "bg-background"}`}
    >
      <PanelHeader followUp={off} title={baja ? "WhatsApp no entregó el seguimiento" : "Seguimientos cancelados en este chat"} onClose={onClose} />
      <div className="p-3">
        {baja ? (
          <p className="select-text">
            El cliente se dio de baja de las promociones de Diluvium. El seguimiento ya se canceló y no se le mandarán más plantillas. Si escribe, el Agente IA y los
            vendedores le contestan normal.
          </p>
        ) : (
          <p className="text-muted-foreground select-text">
            {`Los canceló ${off.byName ?? "un vendedor"}${off.at ? ` ${onDate(off.at)}` : ""}. El Agente IA no arma seguimientos en este chat hasta que alguien los reactive.`}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {baja ? (
            <>
              <button type="button" onClick={onClose} className={`${button} border-red-700 bg-red-700 text-white`}>
                Entendido
              </button>
              <button type="button" disabled={busy} onClick={() => void run(() => quitarSinSeguimientos(off.contactId))} className={`${button} border-red-500`}>
                Volver a darle seguimiento
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => void run(() => reactivarSeguimientos(off.conversationId))} className={`${button} border-brand-navy hover:bg-brand-navy/10`}>
              Reactivar seguimientos
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}

// ── Burbuja ──────────────────────────────────────────────────────────────────

export function FollowUpPanel({ followUp, onClose, onChanged }: { followUp: FollowUpState; onClose: () => void; onChanged: () => void }) {
  if (followUp.estado === "dormido") return <DormidoPanel dormido={followUp} onClose={onClose} onChanged={onChanged} />;
  if (followUp.estado !== "activo") return <OffPanel off={followUp} onClose={onClose} onChanged={onChanged} />;
  return <ActivePanel followUp={followUp} onClose={onClose} onChanged={onChanged} />;
}

/** Sin nada que seguir: por qué, y «Apagar seguimientos en este chat» (queda «Cancelado» hasta que alguien los reactive). */
function DormidoPanel({ dormido, onClose, onChanged }: { dormido: FollowUpDormido; onClose: () => void; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-brand-navy/10 disabled:opacity-50";
  const apagar = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apagarSeguimientos(dormido.conversationId);
      if (!r.ok) setError(r.message);
      else onChanged();
    } catch {
      setError("No se pudo guardar. Inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      data-testid="followup-panel"
      className="mb-2 overflow-hidden rounded-lg border bg-background text-sm shadow-md select-none"
    >
      <PanelHeader followUp={dormido} title="Seguimiento del Agente IA" onClose={onClose} />
      <div className="space-y-2 p-3">
        <Answer question="¿Por qué no hay seguimiento?">{dormido.razon}</Answer>
        {confirm ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs dark:border-red-500/40 dark:bg-red-500/10">
            <span>¿Apagar los seguimientos de este chat? El Agente IA no arma seguimientos aquí hasta que alguien los reactive.</span>
            <button type="button" disabled={busy} onClick={() => void apagar()} className={`${button} border-red-400 text-red-700 dark:text-red-300`}>
              Sí, apagar
            </button>
            <button type="button" onClick={() => setConfirm(false)} className={button}>
              No
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className={`${button} text-red-700 dark:text-red-300`}>
            Apagar seguimientos en este chat
          </button>
        )}
        {error && <p className="text-xs font-medium text-red-600 select-text dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function Answer({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{question}</p>
      <div className="leading-snug select-text">{children}</div>
    </div>
  );
}

/** Un renglón por mensaje que ya salió (o lo mandó un vendedor), sin el nombre de la plantilla. */
function sentLine(a: FollowUpView["intentos"][number], index: number): { ok: boolean; text: string } {
  const what = `${ordinal(index + 1)} mensaje`;
  if (a.modo === "vendedor") return { ok: true, text: `${what}: lo mandó un vendedor ${onDate(a.at)}` };
  if (a.ensayo) return { ok: true, text: `${what}: habría salido ${onDate(a.at)}` };
  if (a.error) return { ok: false, text: `${what}: no salió ${onDate(a.at)} · ${a.error}` };
  return { ok: true, text: `${what}: salió ${onDate(a.at)}${a.modo === "sugerido" ? " (sugerido)" : ""}` };
}

function ActivePanel({ followUp, onClose, onChanged }: { followUp: FollowUpView; onClose: () => void; onChanged: () => void }) {
  const [showMessage, setShowMessage] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [local, setLocal] = useState(followUp.dueAt ? instantToLocal(new Date(followUp.dueAt)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = followUp;
  const due = f.dueAt ? new Date(f.dueAt) : null;
  const clientHour = due && dayKey(due, f.timeZone) + hourOf(due, f.timeZone) !== dayKey(due, SCHEDULE_TIME_ZONE) + hourOf(due, SCHEDULE_TIME_ZONE) ? hourOf(due, f.timeZone) : null;
  // Lo que va a salir, exacto: el texto del Agente IA con su saludo, o la plantilla ya llena.
  const message = f.door === "plantilla" ? (f.templateText ?? f.templateName) : f.borrador ? followUpText(f.borrador, due ?? new Date(), f.timeZone) : null;
  const programado = f.status === "programado";
  const sent = f.intentos.length;

  const run = async (action: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) setError(result.message);
      else onChanged();
      return result.ok;
    } catch {
      setError("No se pudo guardar. Inténtalo otra vez.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const button = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-brand-navy/10 disabled:opacity-50";
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      data-testid="followup-panel"
      className="mb-2 flex max-h-[min(26rem,55cqh)] min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-md select-none"
    >
      <PanelHeader followUp={f} title="Seguimiento del Agente IA" onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 text-sm">
        {f.ensayo && <p className="text-xs text-muted-foreground">Modo ensayo: así trabajaría el seguimiento; no se le manda nada al cliente.</p>}
        <Answer question="¿Dónde se quedó el chat?">{f.pendiente ?? f.casoLabel}</Answer>
        <Answer question="¿Qué busca el seguimiento?">{f.siguientePaso ?? f.objetivo}</Answer>
        {programado ? (
          <Answer question={`¿Cuándo sale el ${ordinal(sent + 1)} mensaje?`}>
            {due ? dateLabel(f.dueAt!) : "—"}
            {clientHour && <span className="text-muted-foreground">{` (su hora: ${clientHour}, ${ZONE_NAMES[f.timeZone] ?? f.timeZone})`}</span>}
            {f.dueSetBy === "vendedor" && <span className="text-muted-foreground"> · hora puesta a mano</span>}
          </Answer>
        ) : (
          <Answer question="¿Y ahora?">
            {sent === 1 ? `Ya ${f.ensayo ? "habría salido" : "salió"} el mensaje` : `Ya ${f.ensayo ? "habrían salido" : "salieron"} los ${sent} mensajes`}
            {f.terminado ? " y no ha contestado (pasó a frío). Si escribe, el Agente IA le contesta." : due ? `. Si no contesta ${beforeDate(f.dueAt!)}, pasa a frío.` : "."}
          </Answer>
        )}
        {programado && f.modo === "sugerido" && (
          <p className="rounded-md border border-amber-400/60 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {f.autoAprobado
              ? "Saldrá solo a su hora (lo aprobó un vendedor)."
              : `No sale solo: el Agente IA está en pausa a mano en este chat.${f.presentarAt ? ` Se le recuerda al vendedor: ${dateLabel(f.presentarAt)}.` : ""}`}
          </p>
        )}

        {sent > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {f.intentos.map((a, i) => {
              const line = sentLine(a, i);
              return (
                <li key={`${a.n}-${a.at}`} className={line.ok ? "" : "text-red-700 dark:text-red-300"}>
                  <span aria-hidden="true">{line.ok ? "✓ " : "✗ "}</span>
                  {line.text}
                </li>
              );
            })}
          </ul>
        )}

        {showMessage && programado && (
          <div data-testid="followup-message" className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-[13px] select-text">
            {message ?? "El Agente IA no dejó el mensaje para este chat."}
          </div>
        )}

        {editing && (
          <div className="flex flex-wrap items-center gap-2">
            <DateTimePicker mode="datetime" value={local} onChange={setLocal} aria-label="Nueva hora (Mazatlán)" className="rounded-md border bg-background px-2 py-1 text-sm" />
            <span className="text-xs text-muted-foreground">hora de Mazatlán</span>
            <button
              type="button"
              disabled={busy || !local}
              onClick={() => void run(() => rescheduleFollowUp(f.id, local)).then((ok) => ok && setEditing(false))}
              className={`${button} border-brand-navy`}
            >
              Guardar
            </button>
          </div>
        )}

        {confirmCancel ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs dark:border-red-500/40 dark:bg-red-500/10">
            <span>¿Cancelar los seguimientos de este chat? Se cancelan los intentos que faltan y el Agente IA no arma otros aquí hasta que alguien los reactive.</span>
            <button type="button" disabled={busy} onClick={() => void run(() => cancelFollowUp(f.id)).then((ok) => ok && onClose())} className={`${button} border-red-400 text-red-700 dark:text-red-300`}>
              Sí, cancelar
            </button>
            <button type="button" onClick={() => setConfirmCancel(false)} className={button}>
              No
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {programado && (
              <button type="button" onClick={() => setShowMessage((v) => !v)} className={button} aria-expanded={showMessage}>
                {showMessage ? "Ocultar mensaje" : "Ver mensaje"}
              </button>
            )}
            {programado && (
              <button type="button" onClick={() => setEditing((v) => !v)} className={button} aria-expanded={editing}>
                Cambiar hora
              </button>
            )}
            {programado && f.phoneE164 && f.borrador && (
              <a
                href={whatsappWebLink(f.phoneE164, followUpText(f.borrador, new Date(), f.timeZone))}
                target="_blank"
                rel="noopener noreferrer"
                className={button}
                title="Abre WhatsApp Web con el texto ya escrito (gratis y sin ventana de 24 h)"
              >
                Lo mando yo
              </a>
            )}
            {programado && f.modo === "sugerido" && !f.autoAprobado && (
              <button type="button" disabled={busy} onClick={() => void run(() => approveSuggestedFollowUp(f.id))} className={`${button} border-amber-500`}>
                Que salga solo
              </button>
            )}
            <button type="button" onClick={() => setConfirmCancel(true)} className={`${button} text-red-700 dark:text-red-300`}>
              Cancelar
            </button>
          </div>
        )}
        {error && <p className="text-xs font-medium text-red-600 select-text dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
