// Cómo se ve cada cliente en Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § Amazon
// y Mercado Libre). Puro; el servidor lo arma y el panel solo pinta. Cada cliente cae en UNA
// sección con UNA acción, según las reglas de su tienda (sin marcarlo a mano).
import { zoneForPhone } from "@/lib/followups/timezone";
import { formatMazatlan } from "@/lib/historial/labels";
import { canSendFreeForm } from "@/lib/messaging/rules";
import { mensajeResena, textoPlantillaResena } from "./mensaje";
import type { ResenaFila } from "./queries";
import { TIENDA_NOMBRE } from "./tiendas";

/** Para pedir: se puede hoy. En espera: todavía no (dice desde cuándo o qué falta). Ya pedidas: salió el texto. */
export type SeccionResena = "pedir" | "espera" | "pedida";

/** amazon = abrir Seller Central; texto = mandar el texto fijo; plantilla = mandar «Reseña en tienda». */
export type AccionResena = "amazon" | "texto" | "plantilla";

export type ResenaVista = {
  id: string;
  titulo: string;
  tienda: string;
  frase: string | null;
  /** «Lo dijo el …». */
  dicho: string;
  seccion: SeccionResena;
  accion: AccionResena | null;
  /** Una línea: qué hacer o por qué todavía no. */
  aviso: string;
  /** Lo que saldría (texto o plantilla), para verlo antes de mandarlo. */
  mensaje: string | null;
  /** Orden dentro de su sección (menor primero). */
  orden: number;
  /** Abre su chat en la Bandeja. */
  chatHref: string;
};

/** Pedidos de Seller Central México: ahí, en el pedido, está «Solicitar una reseña». */
export const SELLER_CENTRAL_PEDIDOS = "https://sellercentral.amazon.com.mx/orders-v3";

/**
 * Amazon solo deja contactar al comprador por su propio servicio de mensajes (código de conducta
 * para vendedores en México, G1801) y su «Solicitar una reseña» sirve hasta 30 días después de la
 * entrega. Se cuenta desde que lo dijo, con hasta una semana para la entrega; después ya no sale.
 */
export const DIAS_AMAZON = 35;

/**
 * Mercado Libre prohíbe escribirle al comprador por otro medio hasta que vence Compra Protegida
 * (30 días después de recibirla; cláusula 3 b de sus términos). Se cuenta desde que dijo que
 * compró, con hasta una semana para la entrega.
 */
export const DIAS_MERCADO_LIBRE = 40;

const DIA_MS = 24 * 60 * 60 * 1000;
const masDias = (at: Date, dias: number) => new Date(at.getTime() + dias * DIA_MS);
const soloFecha = (at: Date) => formatMazatlan(at).split(" ")[0];

type Paso = { seccion: SeccionResena; accion: AccionResena | null; aviso: string; orden: number };

/** Dónde está cada cliente hoy. null = de Amazon y ya pasó su plazo: ya no sale en la lista. */
export function pasoDe(
  f: Pick<ResenaFila, "tienda" | "estado" | "createdAt" | "pedidaAt" | "conversationId" | "canal" | "windowExpiresAt" | "plantillaAt">,
  now: Date,
): Paso | null {
  if (f.tienda === "amazon") {
    const hasta = masDias(f.createdAt, DIAS_AMAZON);
    if (now >= hasta) return null;
    return {
      seccion: "pedir",
      accion: "amazon",
      aviso: `En su pedido de Seller Central, toque «Solicitar una reseña». Amazon deja hasta el ${soloFecha(hasta)}.`,
      orden: hasta.getTime(),
    };
  }
  if (f.estado !== "por_pedir") {
    const cuando = f.pedidaAt ?? f.createdAt;
    return { seccion: "pedida", accion: null, aviso: `Se le pidió el ${formatMazatlan(cuando)}.`, orden: -cuando.getTime() };
  }
  const desde = masDias(f.createdAt, DIAS_MERCADO_LIBRE);
  if (now < desde) {
    return {
      seccion: "espera",
      accion: null,
      aviso: `Se le puede escribir desde el ${soloFecha(desde)}: antes, Mercado Libre no lo permite (Compra Protegida).`,
      orden: desde.getTime(),
    };
  }
  if (!f.conversationId || !f.canal) {
    return { seccion: "espera", accion: null, aviso: "Ya no está el chat donde lo dijo.", orden: desde.getTime() };
  }
  if (canSendFreeForm(f.canal, f.windowExpiresAt, now, true)) {
    return { seccion: "pedir", accion: "texto", aviso: "Ya se le puede pedir por WhatsApp.", orden: desde.getTime() };
  }
  if (f.canal === "instagram") {
    return {
      seccion: "espera",
      accion: null,
      aviso: "Pasaron más de 7 días desde su último mensaje: se le pide cuando vuelva a escribir.",
      orden: desde.getTime(),
    };
  }
  if (f.plantillaAt) {
    return {
      seccion: "espera",
      accion: null,
      aviso: `Le mandamos la plantilla el ${formatMazatlan(f.plantillaAt)}: cuando conteste, sale «Pedir reseña».`,
      orden: f.plantillaAt.getTime(),
    };
  }
  return {
    seccion: "pedir",
    accion: "plantilla",
    aviso: "Pasaron más de 24 h desde su último mensaje: primero va la plantilla.",
    orden: desde.getTime(),
  };
}

export function resenaVista(f: ResenaFila, now: Date): ResenaVista | null {
  const paso = pasoDe(f, now);
  if (!paso) return null;
  return {
    id: f.id,
    titulo: f.contacto || "Cliente",
    tienda: TIENDA_NOMBRE[f.tienda],
    frase: f.frase,
    dicho: `Lo dijo el ${soloFecha(f.createdAt)}`,
    ...paso,
    mensaje:
      paso.accion === "texto"
        ? mensajeResena(f.tienda, now, zoneForPhone(f.telefono))
        : paso.accion === "plantilla"
          ? textoPlantillaResena(f.tienda)
          : null,
    chatHref: `/dashboard?contacto=${encodeURIComponent(f.contactId)}`,
  };
}
