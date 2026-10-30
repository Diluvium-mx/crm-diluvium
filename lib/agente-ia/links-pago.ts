// Links de pago del Agente IA (30-oct-2026, docs/agente-ia/2026-10-30-links-de-pago.md). PURO (sin BD)
// y seguro para el cliente: lo usan el editor (Agente IA › Links de pago) y el runtime.
//
// Antes, a quien elegía pagar con tarjeta el Agente IA le decía «un asesor le envía el link» y avisaba
// al vendedor; del 27-sep al 29-oct pasó 16 veces y solo 8 recibieron el link (de 1 minuto a casi 2
// días después). Ahora el Agente IA elige la opción y el CRM manda el link EXACTO de esta lista (el
// modelo nunca lo escribe: una letra mal y el link no sirve). Candados del CRM, aunque el modelo la pida:
// - lada fuera de México (salvo +1, que cuenta como de México): nunca recibe un link (regla del dueño);
// - el link debe cobrar el total acordado en el chat (o la mitad, en el anticipo o la liquidación de una
//   compuerta a la medida); si no cuadra, no sale y un asesor lo manda;
// - máximo MAX_LINKS_POR_CHAT links del Agente IA por chat.
// Los de precio especial (descuentos, Los Mochis) van marcados «Solo vendedor»: salen en el ⚡ del chat y el
// Agente IA nunca los ve. Con cada link salen DOS mensajes (30-oct-2026, regla del dueño): el 1.º con el
// link y, aparte, el 2.º que pide los datos de envío (primero el pago, después los datos: da confianza).
// Los dos se editan en Agente IA › Links de pago.
import { z } from "zod";
import { foreignLadaLabel } from "@/lib/phone";
import { normalizeSearch } from "@/lib/text/search";

export type LinkCubre = "total" | "mitad";

export type LinkPago = {
  id: string;
  nombre: string;
  monto: number;
  cubre: LinkCubre;
  /** Hasta cuántos meses sin intereses (0 = de contado). */
  meses: number;
  url: string;
  /** Precio especial: solo lo manda un vendedor desde el ⚡ (el Agente IA nunca lo ve). */
  soloVendedor: boolean;
  posicion: number;
};

/** Los que puede mandar el Agente IA (los «Solo vendedor» nunca). */
export function linksDelAgente<T extends Pick<LinkPago, "soloVendedor">>(links: readonly T[]): T[] {
  return links.filter((l) => !l.soloVendedor);
}

/** Una opción de la herramienta del Agente IA: su clave y el link que manda. */
export type OpcionLink = { clave: string; link: LinkPago };

/** Cuántos links puede mandar el Agente IA en un mismo chat (si lo vuelve a pedir, se le reenvía). */
export const MAX_LINKS_POR_CHAT = 3;

/** Lo que sale en lugar del link cuando no pasa los candados (y el vendedor recibe el aviso). */
export const LINK_POR_ASESOR = "En un momento un asesor le comparte el link de pago.";

export const CUBRE_LABEL: Record<LinkCubre, string> = {
  total: "El total",
  mitad: "La mitad (anticipo o liquidación)",
};

const httpsUrl = z
  .string()
  .trim()
  .max(300, "El link es demasiado largo.")
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "El link debe empezar con https:// (cópialo completo de MercadoPago).");

export const linkPagoInputSchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre.").max(80, "El nombre es demasiado largo."),
  monto: z.number().positive("El monto debe ser mayor a cero.").max(9_999_999),
  cubre: z.enum(["total", "mitad"]),
  meses: z.number().int().min(0).max(24),
  url: httpsUrl,
  soloVendedor: z.boolean().default(false),
});

export type LinkPagoInput = z.input<typeof linkPagoInputSchema>;

export const linksPagoSchema = z
  .array(linkPagoInputSchema)
  .max(30, "Máximo 30 links.")
  .superRefine((links, ctx) => {
    const seen = new Set<string>();
    for (const l of links) {
      const key = normalizeSearch(l.nombre);
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: `El nombre «${l.nombre}» está repetido.` });
      seen.add(key);
    }
  });

/** Errores para mostrar en el editor antes de guardar (los mismos que valida el servidor). */
export function validateLinksPago(links: readonly LinkPagoInput[]): string[] {
  const r = linksPagoSchema.safeParse(links);
  return r.success ? [] : [...new Set(r.error.issues.map((i) => i.message))];
}

// Clave de la opción para el modelo: el nombre sin acentos, en minúsculas y con guiones bajos
// («2 compuertas estándar» → «2_compuertas_estandar»). Repetida → «_2», «_3».
export function opcionesDe(links: readonly LinkPago[]): OpcionLink[] {
  const used = new Set<string>();
  return [...links]
    .sort((a, b) => a.posicion - b.posicion)
    .map((link) => {
      const base =
        normalizeSearch(link.nombre)
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 40) || "link";
      let clave = base;
      for (let n = 2; used.has(clave); n++) clave = `${base}_${n}`;
      used.add(clave);
      return { clave, link };
    });
}

/** «$5,500» (sin centavos si no los hay). */
export const pesos = (n: number) => `$${n.toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;

/** El total del chat que debe estar acordado para mandar este link. */
export function totalQueCubre(link: Pick<LinkPago, "monto" | "cubre">): number {
  return link.cubre === "mitad" ? link.monto * 2 : link.monto;
}

/** ¿El link cobra lo acordado? Comparación en centavos (sin errores de punto flotante). */
export function linkCuadra(link: Pick<LinkPago, "monto" | "cubre">, total: number): boolean {
  return Math.round(totalQueCubre(link) * 100) === Math.round(total * 100);
}

/**
 * ¿La lada impide mandar links? Devuelve el país («Perú (+51)») o null. Misma regla que los
 * seguimientos (`foreignLadaLabel`): México y +1 (Estados Unidos, Canadá, el Caribe) sí reciben;
 * sin teléfono (Instagram) también.
 */
export function ladaSinLinks(iso: string | null | undefined, code: string | null | undefined): string | null {
  return foreignLadaLabel(iso, code);
}

// ── Los dos mensajes (editables) ──────────────────────────────────────────
export type TextosLink = { mensaje1: string; mensaje2: string };

export const VARIABLES_LINK = ["monto", "link", "forma_de_pago"] as const;

export const TEXTOS_DE_FABRICA: TextosLink = {
  mensaje1: "Aquí le paso el link para pagar {{monto}} con tarjeta por MercadoPago ✅\n\n{{link}}\n\n{{forma_de_pago}}",
  mensaje2: "Una vez realizado el pago, nos apoya con sus datos de envío:\nNombre de quien recibe\nDirección\nCódigo postal\nTeléfono\nCorreo electrónico",
};

export const MAX_TEXTO_LINK = 1000;

export const textosLinkSchema = z.object({
  mensaje1: z
    .string()
    .trim()
    .min(1, "Falta el mensaje 1.")
    .max(MAX_TEXTO_LINK, `El mensaje 1 pasa de ${MAX_TEXTO_LINK} caracteres.`)
    .refine((t) => t.includes("{{link}}"), "El mensaje 1 debe llevar {{link}} (ahí va el link)."),
  mensaje2: z.string().trim().max(MAX_TEXTO_LINK, `El mensaje 2 pasa de ${MAX_TEXTO_LINK} caracteres.`),
});

/** Errores de los textos para el editor (variables desconocidas incluidas). */
export function validateTextosLink(textos: TextosLink): string[] {
  const r = textosLinkSchema.safeParse(textos);
  const errors = r.success ? [] : r.error.issues.map((i) => i.message);
  for (const [n, t] of [["1", textos.mensaje1], ["2", textos.mensaje2]] as const) {
    for (const m of t.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
      if (!(VARIABLES_LINK as readonly string[]).includes(m[1])) errors.push(`El mensaje ${n} tiene {{${m[1]}}}: solo valen {{monto}}, {{link}} y {{forma_de_pago}}.`);
    }
  }
  return [...new Set(errors)];
}

/** Cómo se paga ese link, en una frase ({{forma_de_pago}}). */
export function formaDePago(link: Pick<LinkPago, "meses">): string {
  return link.meses > 0
    ? `Puede pagar con tarjeta de crédito o débito, y con crédito elegir hasta ${link.meses} meses sin intereses.`
    : "Es un pago de contado con tarjeta de crédito o débito.";
}

/** Lo que recibe el cliente, en orden: el mensaje con el link y, si no está vacío, el de los datos de envío. */
export function mensajesLink(link: Pick<LinkPago, "monto" | "meses" | "url">, textos: TextosLink = TEXTOS_DE_FABRICA): string[] {
  const vars: Record<(typeof VARIABLES_LINK)[number], string> = { monto: pesos(link.monto), link: link.url.trim(), forma_de_pago: formaDePago(link) };
  const fill = (t: string) => t.replace(/\{\{\s*(monto|link|forma_de_pago)\s*\}\}/g, (_, k: keyof typeof vars) => vars[k]).trim();
  const uno = fill(textos.mensaje1);
  const dos = fill(textos.mensaje2);
  return dos ? [uno, dos] : [uno];
}

/** Qué cobra cada opción, en una línea para la herramienta del modelo. */
export function describeOpcion({ clave, link }: OpcionLink): string {
  const pago = link.meses > 0 ? `hasta ${link.meses} meses sin intereses` : "de contado";
  const cubre = link.cubre === "mitad" ? `cobra ${pesos(link.monto)}, la mitad de un total de ${pesos(link.monto * 2)}` : `cobra ${pesos(link.monto)}`;
  return `${clave} = ${link.nombre}: ${cubre}, ${pago}`;
}

export function linkPagoDescription(opciones: readonly OpcionLink[]): string {
  return (
    "Manda al cliente el link de MercadoPago para pagar con tarjeta: el CRM lo envía después de tu texto, con el monto y el link exactos (nunca escribas tú un link de pago). " +
    "Úsala cuando el cliente elige pagar con tarjeta o pide el link de pago, con el total ya fijado; si lo vuelve a pedir, úsala otra vez. " +
    `Opciones: ${opciones.map(describeOpcion).join("; ")}. ` +
    "El link debe cobrar exactamente el total acordado (o la mitad, en las de anticipo o liquidación); si no hay una opción para lo que eligió, no la uses y sigue el Goal."
  );
}
