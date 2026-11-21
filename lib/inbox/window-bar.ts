// Barra de arriba del chat (20-nov-2026, propuesta A del dueño: «el precio primero, en una palabra»). Dice de un
// vistazo si lo que sale del CRM es GRATIS o CUESTA, y el color es el precio: verde gratis, azul con costo, ámbar aviso
// o acción, gris no se puede. Lo de los centavos va en el title (al pasar el mouse). Reglas de cobro (no inventar):
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
export type WindowBarIcon = "gift" | "coin" | "clock" | "template" | "instagram" | "test";

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
  /** Entrada por anuncio; metaFreeUntil = la marca de Meta vigente (puede pasar de 72 h). */
  adEntry: { entryAt: Date; firstReplyAt: Date | null; metaFreeUntil: Date | null } | null;
  /** Mensajes de servicio gratis que quedan este mes en el número (null = no se sabe). */
  servicioGratisQuedan: number | null;
  now: Date;
};

// Menos de esto para que cierre la ventana = aviso «Cierra en…» (el dueño: «menos de 2 h»).
export const POCO_TIEMPO_MS = 2 * 3_600_000;
// Con menos de estos gratis del mes, la barra ya dice «Con costo»: lo que reporta Meta llega con horas de atraso.
export const GRATIS_MES_MARGEN = 50;

// Pesos por dólar para los centavos del title: el promedio de octubre del correo de costos (US$98.64 = $1,815).
// Es aproximado a propósito («≈»); si Meta cambia precios se cambia META_RATE_USD y esto los sigue.
const PESOS_POR_DOLAR_APROX = 18.4;
function centavos(usd: number | undefined): string {
  const c = Math.max(5, Math.round(((usd ?? 0) * PESOS_POR_DOLAR_APROX * 100) / 5) * 5);
  return `≈ ${c} centavos`;
}
const TEXTO = centavos(META_RATE_USD.service);
const PLANTILLA_VENTA = centavos(META_RATE_USD.marketing);
const PLANTILLA_UTILIDAD = centavos(META_RATE_USD.utility).replace(" centavos", "");
const PLANTILLAS = `${PLANTILLA_VENTA} la de venta, ${PLANTILLA_UTILIDAD} la de utilidad`;
const CELULAR = "Lo que escribas desde el celular o WhatsApp Web no se cobra.";

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

/** Hasta cuándo es gratis por el anuncio: primero la marca de Meta, si no la regla de 72 h del CRM. */
function tiempoGratis(adEntry: WindowBarInput["adEntry"], now: Date) {
  if (!adEntry) return null;
  if (adEntry.metaFreeUntil && adEntry.metaFreeUntil > now) return { status: "open" as const, until: adEntry.metaFreeUntil };
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
  const abierta = isWindowOpen(windowExpiresAt, now);
  const queda = abierta && windowExpiresAt ? windowExpiresAt.getTime() - now.getTime() : 0;

  if (input.channelType === "instagram") {
    if (abierta) {
      return {
        tone: "gratis",
        icon: "instagram",
        strong: "Gratis",
        rest: `· cualquiera puede escribir ${tiempoQueQueda(queda)} más`,
        title: "Instagram no cobra mensajes. Pasadas 24 h desde su último mensaje, solo un vendedor puede contestar (hasta 7 días); el Agente IA y las automatizaciones ya no.",
      };
    }
    const vendedorHasta = humanAgentExpiresAt(windowExpiresAt);
    if (vendedorHasta && vendedorHasta > now) {
      return {
        tone: "gratis",
        icon: "instagram",
        strong: "Gratis",
        rest: `· solo un vendedor puede contestar, hasta ${fechaBarra(vendedorHasta)}`,
        title: "Instagram no cobra mensajes. Pasaron 24 h desde su último mensaje: el Agente IA y las automatizaciones ya no pueden escribir.",
      };
    }
    return {
      tone: "cerrado",
      icon: "instagram",
      strong: "No se puede escribir",
      rest: windowExpiresAt ? "· Instagram no deja hasta que el cliente vuelva a escribir" : "· en Instagram el cliente escribe primero",
      title: "Instagram no tiene plantillas: después de 7 días sin mensajes del cliente nadie puede escribirle.",
    };
  }

  const gratis = tiempoGratis(input.adEntry, now);
  if (gratis?.status === "open") {
    if (abierta) {
      // Si la ventana de 24 h cierra antes que lo gratis, también se dice cuánto queda para escribir.
      const cierraAntes = windowExpiresAt! < gratis.until;
      return {
        tone: "gratis",
        icon: "gift",
        strong: "Gratis",
        rest: `por anuncio hasta ${fechaBarra(gratis.until)}${cierraAntes ? ` · puedes escribir ${tiempoQueQueda(queda)} más` : ""}`,
        title:
          "Llegó por anuncio: hasta esa hora todo lo que sale del CRM es gratis, también las plantillas." +
          (cierraAntes ? " El texto libre solo se puede mientras el cliente haya escrito en las últimas 24 h; después, plantilla (gratis hasta esa hora)." : ""),
      };
    }
    return {
      tone: "gratis",
      icon: "gift",
      strong: "Plantilla gratis",
      rest: `hasta ${fechaBarra(gratis.until)}${windowExpiresAt ? " · el texto ya no (pasaron 24 h)" : ""}`,
      title: "Sigue el tiempo gratis del anuncio, pero pasaron 24 h desde su último mensaje: desde el CRM solo sale plantilla, y es gratis hasta esa hora.",
    };
  }
  if (gratis?.status === "pending") {
    return {
      tone: "aviso",
      icon: "gift",
      strong: `Contesta antes de ${fechaBarra(gratis.replyBy)}`,
      rest: "y todo es gratis por 72 h",
      title: "Llegó por anuncio y nadie le ha contestado. Si le contestas antes de esa hora, todo lo que salga en las 72 h siguientes es gratis, también las plantillas.",
    };
  }

  if (abierta) {
    const quedan = input.servicioGratisQuedan;
    const gratisMes = quedan !== null && quedan >= GRATIS_MES_MARGEN;
    if (queda < POCO_TIEMPO_MS) {
      return {
        tone: "aviso",
        icon: "clock",
        strong: `Cierra en ${tiempoQueQueda(queda)}`,
        rest: "· después solo plantilla, que cuesta más",
        title: `Hasta esa hora se puede mandar texto libre (${gratisMes ? "hoy gratis: quedan de los 1,000 del mes" : `${TEXTO} cada mensaje`}). Después, desde el CRM solo sale plantilla: ${PLANTILLAS}.`,
      };
    }
    if (gratisMes) {
      const aprox = Math.floor(quedan / 10) * 10;
      return {
        tone: "gratis",
        icon: "gift",
        strong: "Gratis",
        rest: `· puedes escribir ${tiempoQueQueda(queda)} más · quedan ≈ ${aprox.toLocaleString("es-MX")} de los 1,000 del mes`,
        title: `Meta no cobra los primeros 1,000 mensajes del mes (cuentan también los del Agente IA y las automatizaciones). Cuando se acaben, cada mensaje cuesta ${TEXTO}. La cuenta la reporta Meta y puede tardar unas horas.`,
      };
    }
    return {
      tone: "costo",
      icon: "coin",
      strong: "Con costo",
      rest: `· puedes escribir ${tiempoQueQueda(queda)} más`,
      title: `Cada mensaje que sale del CRM (tuyo, del Agente IA o de una automatización) cuesta ${TEXTO}. ${CELULAR}`,
    };
  }

  if (windowExpiresAt === null) {
    // Chat abierto por nosotros (primer mensaje, 28-sep-2026): el cliente aún no escribe.
    return {
      tone: "aviso",
      icon: "template",
      strong: "Solo plantilla, con costo",
      rest: "· el cliente todavía no escribe · gratis desde el celular",
      title: `Mientras el cliente no conteste, desde el CRM solo sale plantilla: ${PLANTILLAS}. ${CELULAR}`,
    };
  }
  return {
    tone: "aviso",
    icon: "template",
    strong: "Solo plantilla, con costo",
    rest: "· gratis desde el celular",
    title: `Pasaron 24 h desde su último mensaje: desde el CRM solo sale plantilla (${PLANTILLAS}). ${CELULAR}`,
  };
}
