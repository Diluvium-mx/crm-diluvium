// Cómo se ve cada cliente en Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § Amazon
// y Mercado Libre). Puro; el servidor lo arma y el panel solo pinta.
import { zoneForPhone } from "@/lib/followups/timezone";
import { formatMazatlan } from "@/lib/historial/labels";
import { canSendFreeForm } from "@/lib/messaging/rules";
import type { TonoEtiqueta } from "@/lib/opiniones/vista";
import { mensajeResena } from "./mensaje";
import type { EnlacesTiendas, ResenaFila } from "./queries";
import { TIENDA_NOMBRE, type EstadoResena } from "./tiendas";

export type ResenaVista = {
  id: string;
  titulo: string;
  tienda: string;
  frase: string | null;
  fecha: string;
  estado: EstadoResena;
  estadoTexto: string;
  tono: TonoEtiqueta;
  /** Abre su chat en la Bandeja. */
  chatHref: string;
  /** El texto que saldría (para verlo antes de mandarlo). */
  mensaje: string;
  /** Por qué todavía no se puede pedir; null = se puede. */
  bloqueo: string | null;
};

const ESTADO: Readonly<Record<EstadoResena, { texto: string; tono: TonoEtiqueta }>> = {
  por_pedir: { texto: "Por pedir", tono: "alerta" },
  pedida: { texto: "Pedida", tono: "marca" },
  la_dejo: { texto: "La dejó", tono: "bien" },
  no_quiso: { texto: "No quiso", tono: "neutro" },
  descartada: { texto: "No compró ahí", tono: "neutro" },
};

function soloFecha(at: Date): string {
  return formatMazatlan(at).split(" ")[0];
}

/** Sin plantilla todavía: solo texto libre (WhatsApp 24 h; Instagram 7 días, de un vendedor). */
export function bloqueoDe(f: Pick<ResenaFila, "conversationId" | "canal" | "windowExpiresAt">, now: Date): string | null {
  if (!f.conversationId || !f.canal) return "Ya no está el chat donde lo dijo.";
  if (canSendFreeForm(f.canal, f.windowExpiresAt, now, true)) return null;
  return f.canal === "instagram"
    ? "Pasaron más de 7 días desde su último mensaje: se puede pedir cuando vuelva a escribir."
    : "Pasaron más de 24 h desde su último mensaje: se puede pedir cuando vuelva a escribir.";
}

export function resenaVista(f: ResenaFila, enlaces: EnlacesTiendas, now: Date): ResenaVista {
  const estado = ESTADO[f.estado];
  return {
    id: f.id,
    titulo: f.contacto || "Cliente",
    tienda: TIENDA_NOMBRE[f.tienda],
    frase: f.frase,
    fecha: f.pedidaAt && f.estado !== "por_pedir" ? `Se le pidió el ${formatMazatlan(f.pedidaAt)}` : `Lo dijo el ${soloFecha(f.createdAt)}`,
    estado: f.estado,
    estadoTexto: estado.texto,
    tono: estado.tono,
    chatHref: `/dashboard?contacto=${encodeURIComponent(f.contactId)}`,
    mensaje: mensajeResena(f.tienda, enlaces[f.tienda], now, zoneForPhone(f.telefono)),
    bloqueo: f.estado === "por_pedir" ? bloqueoDe(f, now) : null,
  };
}
