// Cómo se ve cada cliente en Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § 8). Puro;
// el servidor lo arma y el panel solo pinta. Desde el 6-nov-2026 el CRM ya no manda nada: cada
// cliente trae sus mensajes listos para copiarlos en WhatsApp Web (sin IA y sin plantillas) y el
// vendedor marca «Ya le escribí» (con su «Deshacer»).
import { greetingFor } from "@/lib/followups/message";
import { zoneForPhone } from "@/lib/followups/timezone";
import { formatMazatlan } from "@/lib/historial/labels";
import { enlaceWhatsAppWeb, mensajesWhatsApp, type MensajesWhatsApp } from "./mensaje";
import type { ResenaFila } from "./queries";
import { TIENDA_NOMBRE, type Trato } from "./tiendas";

/** Por solicitar: se le puede escribir hoy. En espera: todavía no. Solicitadas: ya se le escribió. */
export type SeccionResena = "pedir" | "espera" | "pedida";

export type ResenaVista = {
  id: string;
  titulo: string;
  tienda: string;
  frase: string | null;
  /** «Lo dijo el …». */
  dicho: string;
  seccion: SeccionResena;
  /** Una línea: qué hacer o por qué todavía no. */
  aviso: string;
  trato: Trato | null;
  /** Los mensajes para copiar; null si todavía no se le puede escribir. */
  mensajes: MensajesWhatsApp | null;
  /** Abre su chat en WhatsApp Web con el saludo ya escrito; null sin teléfono. */
  whatsappHref: string | null;
  /** «Ya le escribí» (en Por solicitar) o «Deshacer» (en Solicitadas). */
  marca: "escribi" | "deshacer" | null;
  /** Orden dentro de su sección (menor primero). */
  orden: number;
  /** Abre su chat en la Bandeja. */
  chatHref: string;
};

/**
 * Mercado Libre prohíbe escribirle al comprador por otro medio hasta que vence Compra Protegida
 * (30 días después de recibirla; cláusula 3 b de sus términos). Se cuenta desde que dijo que
 * compró, con hasta una semana para la entrega.
 */
export const DIAS_MERCADO_LIBRE = 40;

/**
 * Hasta el 5-nov-2026 las de Amazon se pedían con «Solicitar una reseña» de Seller Central, y al
 * usarlo se acepta no mandar otra solicitud de ese pedido: a esas ya no se les escribe por WhatsApp.
 */
export const DESDE_WHATSAPP = new Date("2026-11-06T07:00:00Z"); // 6-nov-2026 00:00 en Mazatlán

const DIA_MS = 24 * 60 * 60 * 1000;
const masDias = (at: Date, dias: number) => new Date(at.getTime() + dias * DIA_MS);
const soloFecha = (at: Date) => formatMazatlan(at).split(" ")[0];

type Paso = { seccion: SeccionResena; marca: ResenaVista["marca"]; aviso: string; orden: number; conMensajes: boolean };

/** Dónde está cada cliente hoy. */
export function pasoDe(f: Pick<ResenaFila, "tienda" | "estado" | "createdAt" | "pedidaAt" | "telefono">, now: Date): Paso {
  if (f.estado !== "por_pedir") {
    const cuando = f.pedidaAt ?? f.createdAt;
    if (f.tienda === "amazon" && cuando < DESDE_WHATSAPP) {
      return {
        seccion: "pedida",
        marca: null,
        aviso: `Se solicitó en Seller Central el ${formatMazatlan(cuando)}: Amazon no deja volver a pedirla.`,
        orden: -cuando.getTime(),
        conMensajes: false,
      };
    }
    return {
      seccion: "pedida",
      marca: "deshacer",
      aviso: `Le escribiste el ${formatMazatlan(cuando)}. Cuando conteste, usa la respuesta que va.`,
      orden: -cuando.getTime(),
      conMensajes: true,
    };
  }
  if (f.tienda === "mercado_libre") {
    const desde = masDias(f.createdAt, DIAS_MERCADO_LIBRE);
    if (now < desde) {
      return {
        seccion: "espera",
        marca: null,
        aviso: `Se le puede escribir desde el ${soloFecha(desde)}: antes, Mercado Libre no lo permite (Compra Protegida).`,
        orden: desde.getTime(),
        conMensajes: false,
      };
    }
  }
  return {
    seccion: "pedir",
    marca: "escribi",
    aviso: f.telefono
      ? "Escríbele por WhatsApp Web con los mensajes de abajo y después toca «Ya le escribí»."
      : "No tiene teléfono en el CRM: copia los mensajes y búscalo en WhatsApp.",
    // El más antiguo primero.
    orden: f.createdAt.getTime(),
    conMensajes: true,
  };
}

export function resenaVista(f: ResenaFila, now: Date, vendedor: string | null): ResenaVista {
  const { conMensajes, ...paso } = pasoDe(f, now);
  const mensajes = conMensajes
    ? mensajesWhatsApp({ tienda: f.tienda, nombre: f.nombre, trato: f.trato, saludo: greetingFor(now, zoneForPhone(f.telefono)), vendedor })
    : null;
  return {
    id: f.id,
    titulo: f.contacto || "Cliente",
    tienda: TIENDA_NOMBRE[f.tienda],
    frase: f.frase,
    dicho: `Lo dijo el ${soloFecha(f.createdAt)}`,
    ...paso,
    trato: f.trato,
    mensajes,
    whatsappHref: mensajes ? enlaceWhatsAppWeb(f.telefono, mensajes.saludo) : null,
    chatHref: `/dashboard?contacto=${encodeURIComponent(f.contactId)}`,
  };
}
