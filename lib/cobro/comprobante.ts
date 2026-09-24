// Verificación PURA de un comprobante de pago (Fase D; se engancha al agente en
// la parte b). Entrada: lo que el modelo leyó de la foto + lo cotizado (campo
// "monto de cotización" del contacto; si el vendedor lo editó, manda el
// vendedor) + los anticipos ya confirmados + si la referencia ya se usó. Sin
// cotejo de destinatario/CLABE (24-sep-2026): los datos bancarios existen solo
// como imagen en el workflow "Datos bancarios". Confirma SOLO si TODO cuadra; si no, "pasar a humano"
// con el motivo exacto. Sin BD ni red: se testea sola.

export type LecturaComprobante = {
  monto: string | number | null;
  fecha: string | null;
  banco: string | null;
  /** Referencia, folio o clave de rastreo. */
  referencia: string | null;
  /** Moneda tal como se lea ("MXN", "USD", "pesos"); null si no aparece. */
  moneda?: string | null;
};

export type ContextoCotizacion = {
  /** Total cotizado en MXN (contacts.monto_cotizacion). null = sin cotización. */
  totalCotizado: number | null;
  /** Anticipo ya confirmado en esta conversación (MXN), 0 si ninguno. */
  anticipoConfirmado: number;
  /** true si la referencia leída ya fue usada en un pago confirmado de la organización. */
  referenciaYaUsada: boolean;
  /** Quién fijó el total ("agente" | "vendedor" | null); solo informativo. */
  cotizacionPor?: string | null;
  hoy: Date;
};

export type ResultadoComprobante =
  | {
      ok: true;
      tipo: "completo" | "anticipo" | "liquidacion";
      montoMxn: number;
      etapa: "compra" | "cerca_compra";
      referencia: string;
      /** Aviso interno para el vendedor (cotejar en el banco). */
      aviso: string;
    }
  | { ok: false; motivo: string };

export const ANTICIPO_MEDIDA_ESPECIAL_MXN = 3_500;
// Igualdad EXACTA en centavos enteros (sin tolerancia): $748.99 contra $749 NO cuadra.
const centavos = (n: number) => Math.round(n * 100);

// Referencia canónica: sin espacios, guiones ni acentos, en mayúsculas. "ABC-123",
// "abc 123" y "ABC123" son la misma transferencia (índice único por organización).
export function normalizarReferencia(ref: string): string {
  return ref.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ¿La moneda leída es peso mexicano (o no se lee)? "USD 300" nunca cuadra con MXN.
export function esMxn(moneda: string | null | undefined): boolean {
  if (!moneda) return true;
  const m = moneda.trim().toLowerCase();
  return m === "" || /^(mxn|mx\$|\$|mn|m\.n\.|pesos?( mexicanos?)?)$/.test(m);
}

export function parseMontoMxn(raw: string | number | null): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (!raw) return null;
  const clean = raw.replace(/[^\d.,]/g, "");
  if (!clean) return null;
  // "5,500.50" / "5.500,50" / "5500" / "5,500"
  const grouped = clean.match(/^(\d{1,3}(?:([.,])\d{3})+)(?:[.,](\d{1,2}))?$/);
  let n: number;
  if (grouped) n = Number(`${grouped[1].split(grouped[2]).join("")}${grouped[3] ? `.${grouped[3]}` : ""}`);
  else n = Number(clean.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Fechas como salen en comprobantes mexicanos: "23/09/2026", "23-09-26",
// "2026-09-23", "23 sep 2026", "23 de septiembre de 2026". null si no se entiende.
// Solo informativa en el aviso al vendedor: no hay regla de fecha (24-sep-2026).
const MESES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};
export function parseFecha(raw: string | null): Date | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let mm: RegExpMatchArray | null;
  if ((mm = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else if ((mm = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
    d = Number(mm[1]);
    m = Number(mm[2]);
    y = Number(mm[3].length === 2 ? `20${mm[3]}` : mm[3]);
  } else if ((mm = t.match(/^(\d{1,2})\s*(?:de\s+)?([a-záé]+)\.?\s*(?:de\s+)?(\d{4})/))) {
    d = Number(mm[1]);
    m = MESES[mm[2].normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 4)] ?? MESES[mm[2].slice(0, 3)];
    y = Number(mm[3]);
  }
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

const eqMxn = (a: number, b: number) => centavos(a) === centavos(b);

export function verificarComprobante(lectura: LecturaComprobante, ctx: ContextoCotizacion): ResultadoComprobante {
  const humano = (motivo: string): ResultadoComprobante => ({ ok: false, motivo });

  const monto = parseMontoMxn(lectura.monto);
  if (monto === null) return humano("no se alcanza a leer el monto del comprobante");
  const referencia = normalizarReferencia(lectura.referencia ?? "");
  if (referencia.length < 4) return humano("no se alcanza a leer la referencia o clave de rastreo");
  if (!esMxn(lectura.moneda)) return humano(`el comprobante está en ${lectura.moneda}, no en pesos mexicanos`);
  if (ctx.referenciaYaUsada) return humano(`la referencia ${referencia} ya se usó en un pago confirmado antes (posible captura reenviada)`);
  // Sin regla de fecha (decisión del dueño, 24-sep-2026): la fecha solo se copia
  // al aviso para que el vendedor coteje en el banco.
  if (ctx.totalCotizado === null || ctx.totalCotizado <= 0) return humano("el contacto no tiene monto de cotización; el vendedor debe fijarlo en el detalle");
  const total = ctx.totalCotizado;
  const restante = total - ctx.anticipoConfirmado;

  const aviso = (tipo: string) =>
    `${tipo} reportado por el agente: $${monto.toLocaleString("es-MX")} · ${lectura.banco ?? "banco no legible"} · ref. ${referencia} · ${lectura.fecha ?? "sin fecha legible"}. Cotejar el depósito en el banco antes de enviar.`;

  if (ctx.anticipoConfirmado > 0) {
    if (eqMxn(monto, restante)) {
      return { ok: true, tipo: "liquidacion", montoMxn: monto, etapa: "compra", referencia, aviso: aviso("Liquidación") };
    }
    return humano(`ya hay un anticipo de $${ctx.anticipoConfirmado.toLocaleString("es-MX")}; el resto pendiente es $${restante.toLocaleString("es-MX")} y el comprobante dice $${monto.toLocaleString("es-MX")}`);
  }
  if (eqMxn(monto, total)) {
    return { ok: true, tipo: "completo", montoMxn: monto, etapa: "compra", referencia, aviso: aviso("Pago completo") };
  }
  const esAnticipo = eqMxn(monto, total / 2) || (eqMxn(monto, ANTICIPO_MEDIDA_ESPECIAL_MXN) && total > ANTICIPO_MEDIDA_ESPECIAL_MXN);
  if (esAnticipo) {
    return { ok: true, tipo: "anticipo", montoMxn: monto, etapa: "cerca_compra", referencia, aviso: aviso("Anticipo") };
  }
  return humano(`el monto del comprobante ($${monto.toLocaleString("es-MX")}) no coincide con el total cotizado ($${total.toLocaleString("es-MX")}) ni con un anticipo válido`);
}
