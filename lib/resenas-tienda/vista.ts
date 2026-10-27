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
  /** Por qué todavía no se puede pedir por WhatsApp (en Amazon: dónde se pide); null = se puede. */
  bloqueo: string | null;
  /** De Amazon: la reseña se pide en Seller Central, nunca por WhatsApp; aquí solo se anota. */
  enAmazon: boolean;
};

/**
 * Amazon solo deja contactar al comprador por su propio servicio de mensajes (código de conducta
 * para vendedores en México, G1801); su botón «Solicitar una reseña» sirve del día 5 al 30
 * después de la entrega (docs/opiniones.md § 7).
 */
export const AMAZON_SELLER_CENTRAL =
  "Amazon no deja pedirla por WhatsApp: pídala en Seller Central, en su pedido › «Solicitar una reseña» (del día 5 al 30 después de la entrega).";

/**
 * Mercado Libre prohíbe escribirle al comprador por otro medio hasta que vence Compra Protegida
 * (30 días después de recibirla; cláusula 3 b de sus términos). Se cuenta desde que dijo que
 * compró, con hasta una semana para la entrega.
 */
export const DIAS_MERCADO_LIBRE = 40;
const DIA_MS = 24 * 60 * 60 * 1000;

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

/**
 * Por qué todavía no se puede mandar el texto que pide la reseña. Es texto libre (WhatsApp 24 h;
 * Instagram 7 días, de un vendedor); con la ventana cerrada, la plantilla `resena_tienda` se
 * manda desde el chat y su respuesta la abre.
 */
export function bloqueoDe(
  f: Pick<ResenaFila, "tienda" | "createdAt" | "conversationId" | "canal" | "windowExpiresAt">,
  now: Date,
): string | null {
  if (f.tienda === "amazon") return AMAZON_SELLER_CENTRAL;
  const desde = new Date(f.createdAt.getTime() + DIAS_MERCADO_LIBRE * DIA_MS);
  if (now < desde) return `Mercado Libre no deja escribirle por fuera mientras dura Compra Protegida: se puede desde el ${soloFecha(desde)}.`;
  if (!f.conversationId || !f.canal) return "Ya no está el chat donde lo dijo.";
  if (canSendFreeForm(f.canal, f.windowExpiresAt, now, true)) return null;
  return f.canal === "instagram"
    ? "Pasaron más de 7 días desde su último mensaje: se puede pedir cuando vuelva a escribir."
    : "Pasaron más de 24 h desde su último mensaje: mándele la plantilla «Reseña en tienda» desde su chat; cuando conteste, aquí se activa «Pedir reseña».";
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
    enAmazon: f.tienda === "amazon",
  };
}
