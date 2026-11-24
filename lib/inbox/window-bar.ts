// Barra de arriba del chat (20-nov-2026, propuesta A del dueño: «el precio primero, en una palabra»; textos B1–B13 del
// dueño del 24-nov-2026: «Costo de msj: $0.21 · 23 h disponible», «Gratis · 22 h disponible · 640 de 1,000»,
// «Solo plantilla = $0.76 · gratis en WAB»…). Dice de un vistazo si lo que sale del CRM es GRATIS o CUESTA, y el color
// es el precio: verde gratis, azul con costo, ámbar aviso o acción, gris no se puede. El precio va en pesos en la barra;
// el detalle (venta/utilidad, qué es «disponible», WAB) en el title. Reglas de cobro (no inventar):
// docs/meta-whatsapp.md, docs/seguimientos.md §3 y docs/instagram.md:
// - Anuncio: si se le contestó dentro de 24 h, todo lo que sale es gratis (también plantillas) mientras dure el tiempo
//   gratis (la marca de Meta o, sin marca, 72 h; lib/followups/gratis.ts). Es precio, no permiso.
// - Ventana normal de 24 h: cada mensaje del CRM es de servicio; gratis los primeros 1,000 del mes por número y
//   después se cobra (lib/meta-whatsapp/gratis-mes.ts).
// - Ventana cerrada: solo plantilla, que se cobra. Desde el celular o WhatsApp Web no se cobra (coexistencia).
// - Instagram: Meta no cobra; 24 h cualquiera, de 24 h a 7 días solo un vendedor, después nadie.
// PURO (sin base de datos): la UI solo pinta lo que devuelve (app/(app)/dashboard/_components/window-bar.tsx).
import { freeEntryWindow } from "@/lib/ads/free-window";
import { META_RATE_USD } from "@/lib/meta-whatsapp/tarifas";
import { humanAgentExpiresAt, isWindowOpen } from "@/lib/messaging/rules";

export type WindowBarTone = "gratis" | "costo" | "aviso" | "cerrado";
export type WindowBarIcon = "gift" | "coin" | "clock" | "template" | "instagram" | "test" | "archive";

export type WindowBar = {
  tone: WindowBarTone;
  icon: WindowBarIcon;
  /** La palabra que contesta «¿cuesta?», en negritas. */
  strong: string;
  /** Lo que sigue después de la palabra (null = nada). Empieza con «· » cuando es otra idea; sin punto, sigue la frase. */
  rest: string | null;
  /** Al pasar el mouse: por qué y cuánto. */
  title: string;
};

export type WindowBarInput = {
  channelType: string;
  windowExpiresAt: Date | null;
  /** Cliente de prueba de staging: nunca toca WhatsApp. */
  simulado: boolean;
  /** Número archivado (desconectado): desde ahí no se manda nada (ArchivedComposer). */
  archivado: boolean;
  /** Entrada por anuncio; metaFreeUntil = la marca de Meta de ESTA entrada, vigente o vencida (puede pasar de 72 h). */
  adEntry: { entryAt: Date; firstReplyAt: Date | null; metaFreeUntil: Date | null } | null;
  /** Mensajes normales gratis que quedan este mes en el número y hasta cuándo vale el dato (null = no se sabe). */
  servicioGratis: { quedan: number; hasta: Date } | null;
  now: Date;
};

// Menos de esto para que cierre la ventana = aviso ámbar «45 min disponible…» (B6; el dueño: «menos de 2 h»).
export const POCO_TIEMPO_MS = 2 * 3_600_000;
// Con menos de estos gratis del mes, la barra ya dice «Costo de msj»: lo que reporta Meta llega con horas de atraso.
export const GRATIS_MES_MARGEN = 50;

// Precios en pesos (24-nov-2026, textos del dueño: «Costo de msj: $0.21», «Solo plantilla = $0.76»). Meta cobra en
// dólares y sin IVA (META_RATE_USD); aquí se pasan a pesos con el dólar FIX del DOF: promedio del 1 al 24 de noviembre
// de 2026 = 18.73 (lib/costos/tipo-cambio.ts lo lee igual). El monto en pesos se mueve con el dólar: si cambia mucho,
// se actualiza esta línea.
const PESOS_POR_DOLAR = 18.73;
export function pesos(usd: number | undefined): string {
  return `$${((usd ?? 0) * PESOS_POR_DOLAR).toFixed(2)}`;
}
/** Un mensaje normal (texto, foto, archivo) dentro de la ventana, ya sin los 1,000 gratis del mes. */
export const COSTO_MSJ = pesos(META_RATE_USD.service);
/** La plantilla de venta (marketing): la de casi todos los seguimientos. */
export const COSTO_PLANTILLA = pesos(META_RATE_USD.marketing);
const COSTO_UTILIDAD = pesos(META_RATE_USD.utility);
const PLANTILLAS = `${COSTO_PLANTILLA} la de venta, ${COSTO_UTILIDAD} la de utilidad`;
const WAB = "WAB = la app de WhatsApp Business del celular (o WhatsApp Web): lo que escribas ahí no se cobra.";

const FECHA = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mazatlan",
  weekday: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
/** «lun 23, 12:39 p.m.» en hora de Mazatlán, como todo el CRM. */
export const fechaBarra = (d: Date) => FECHA.format(d);

/** Lo que falta: «21 h» (horas enteras hacia arriba) o, con menos de 2 h, «1 h 20 min» / «45 min». */
export function tiempoQueQueda(ms: number): string {
  if (ms >= POCO_TIEMPO_MS) return `${Math.ceil(ms / 3_600_000)} h`;
  const min = Math.max(1, Math.ceil(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Hasta cuándo es gratis por el anuncio: si Meta ya marcó esta entrada, manda su marca (vencida = ya no es gratis);
 *  sin marca, la regla de 72 h del CRM. */
function tiempoGratis(adEntry: WindowBarInput["adEntry"], now: Date) {
  if (!adEntry) return null;
  if (adEntry.metaFreeUntil) return adEntry.metaFreeUntil > now ? { status: "open" as const, until: adEntry.metaFreeUntil } : null;
  const fw = freeEntryWindow(adEntry.entryAt, adEntry.firstReplyAt, now);
  if (fw?.status === "open") return { status: "open" as const, until: fw.until };
  if (fw?.status === "pending") return { status: "pending" as const, replyBy: fw.replyBy };
  return null;
}

export function windowBar(input: WindowBarInput): WindowBar {
  const { now, windowExpiresAt } = input;
  if (input.simulado) {
    return {
      tone: "gratis",
      icon: "test",
      strong: "Cliente de prueba",
      rest: "· la ventana nunca cierra y no cuesta",
      title: "Cliente de prueba de staging: lo que se le manda nunca sale a WhatsApp.",
    };
  }
  if (input.archivado) {
    return {
      tone: "cerrado",
      icon: "archive",
      strong: "No se puede escribir,",
      rest: "este número ya no está conectado",
      title: "El número de este chat ya no está conectado al CRM: el historial queda para consulta y no sale nada.",
    };
  }
  const abierta = isWindowOpen(windowExpiresAt, now);
  const queda = abierta && windowExpiresAt ? windowExpiresAt.getTime() - now.getTime() : 0;

  if (input.channelType === "instagram") {
    if (abierta) {
      return {
        tone: "gratis",
        icon: "instagram",
        strong: "Gratis",
        rest: `hasta ${fechaBarra(windowExpiresAt!)}`,
        title: "Instagram no cobra mensajes. Hasta esa hora escribe cualquiera (también el Agente IA y las automatizaciones); después, hasta 7 días desde su último mensaje, solo un vendedor.",
      };
    }
    const vendedorHasta = humanAgentExpiresAt(windowExpiresAt);
    if (vendedorHasta && vendedorHasta > now) {
      return {
        tone: "gratis",
        icon: "instagram",
        strong: "Gratis",
        rest: `hasta ${fechaBarra(vendedorHasta)}`,
        title: "Instagram no cobra mensajes. Ya pasaron 24 h desde su último mensaje: hasta esa hora solo un vendedor puede contestar (el Agente IA y las automatizaciones ya no).",
      };
    }
    return {
      tone: "cerrado",
      icon: "instagram",
      strong: "No se puede escribir",
      rest: "hasta que cliente responda",
      title: "Instagram no tiene plantillas: pasados 7 días sin mensajes del cliente (o si nunca ha escrito), nadie puede escribirle hasta que él escriba.",
    };
  }

  const gratis = tiempoGratis(input.adEntry, now);
  if (gratis?.status === "open") {
    if (abierta) {
      // Si la ventana de 24 h cierra antes que lo gratis, el title dice hasta cuándo se puede mandar texto libre.
      const cierraAntes = windowExpiresAt! < gratis.until;
      return {
        tone: "gratis",
        icon: "gift",
        strong: "Gratis",
        rest: `por anuncio hasta ${fechaBarra(gratis.until)}`,
        title:
          "Llegó por anuncio: hasta esa hora todo lo que sale del CRM es gratis, también las plantillas." +
          (cierraAntes ? ` El texto libre se puede hasta ${fechaBarra(windowExpiresAt!)} (24 h desde su último mensaje); después, solo plantilla, gratis hasta la hora de la barra.` : ""),
      };
    }
    return {
      tone: "gratis",
      icon: "gift",
      strong: "Plantilla gratis",
      rest: `hasta ${fechaBarra(gratis.until)} · Costo de plantilla: ${COSTO_PLANTILLA}`,
      title: `Sigue el tiempo gratis del anuncio, pero pasaron 24 h desde su último mensaje: desde el CRM solo sale plantilla, gratis hasta esa hora. Después cuesta ${PLANTILLAS}.`,
    };
  }
  if (gratis?.status === "pending") {
    return {
      tone: "aviso",
      icon: "gift",
      strong: "Gratis",
      rest: `hasta ${fechaBarra(gratis.replyBy)}`,
      title: "Llegó por anuncio y nadie le ha contestado: si le contestas antes de esa hora, lo que mandes es gratis y se abren 72 h más gratis (también las plantillas). Si no, se cobra como siempre.",
    };
  }

  if (abierta) {
    // Los gratis del mes solo cuentan mientras el dato esté vigente (un chat abierto horas no los vuelve a leer).
    const gratis = input.servicioGratis && now < input.servicioGratis.hasta ? input.servicioGratis.quedan : null;
    const gratisMes = gratis !== null && gratis >= GRATIS_MES_MARGEN;
    const disponible = `${tiempoQueQueda(queda)} disponible`;
    const deMil = gratisMes ? `${(Math.floor(gratis / 10) * 10).toLocaleString("es-MX")} de 1,000` : "";
    if (queda < POCO_TIEMPO_MS) {
      return {
        tone: "aviso",
        icon: "clock",
        strong: gratisMes ? "Gratis" : disponible,
        rest: gratisMes
          ? `· ${disponible} · ${deMil} · después plantilla: ${COSTO_PLANTILLA}`
          : `· Costo de msj: ${COSTO_MSJ} · después plantilla: ${COSTO_PLANTILLA}`,
        title: `Disponible = lo que queda para mandar texto libre (24 h desde su último mensaje)${gratisMes ? "; hoy es gratis (quedan de los 1,000 del mes)" : `; cada mensaje cuesta ${COSTO_MSJ}`}. Después, desde el CRM solo sale plantilla: ${PLANTILLAS}.`,
      };
    }
    if (gratisMes) {
      return {
        tone: "gratis",
        icon: "gift",
        strong: "Gratis",
        rest: `· ${disponible} · ${deMil}`,
        title: `Meta no cobra los primeros 1,000 mensajes normales del mes (cuentan también los del Agente IA y las automatizaciones); quedan los que dice la barra. Las plantillas sí se cobran (${PLANTILLAS}). Cuando se acaben, cada mensaje cuesta ${COSTO_MSJ}. Disponible = lo que queda para mandar texto libre. La cuenta la reporta Meta y puede tardar unas horas.`,
      };
    }
    return {
      tone: "costo",
      icon: "coin",
      strong: `Costo de msj: ${COSTO_MSJ}`,
      rest: `· ${disponible}`,
      title: `Cada mensaje normal que sale del CRM (tuyo, del Agente IA o de una automatización) cuesta ${COSTO_MSJ}, ya sin los 1,000 gratis del mes. Disponible = lo que queda para mandar texto libre (24 h desde su último mensaje); después solo plantilla: ${PLANTILLAS}. ${WAB}`,
    };
  }

  if (windowExpiresAt === null) {
    // Chat abierto por nosotros (primer mensaje, 28-sep-2026): el cliente aún no escribe.
    return {
      tone: "aviso",
      icon: "template",
      strong: `Solo plantilla = ${COSTO_PLANTILLA}`,
      rest: "· espera mensaje o gratis en WAB",
      title: `El cliente todavía no escribe: desde el CRM solo sale plantilla (${PLANTILLAS}). Cuando conteste, se puede mandar texto. ${WAB}`,
    };
  }
  return {
    tone: "aviso",
    icon: "template",
    strong: `Solo plantilla = ${COSTO_PLANTILLA}`,
    rest: "· gratis en WAB",
    title: `Pasaron 24 h desde su último mensaje: desde el CRM solo sale plantilla (${PLANTILLAS}). ${WAB}`,
  };
}
