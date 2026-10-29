// Correo mensual de costos (docs/costos.md): asunto y cuerpo HTML a partir del reporte. PURO. Estilo de la marca
// (navy, Helvetica; naranja solo para avisos) con estilos en línea, que es lo único que respetan Gmail y Zoho.
// Con tipo de cambio: pesos grandes y dólares abajo en gris; sin él, solo dólares (y el aviso lo explica).
import { formatUsd } from "@/lib/usd-format";
import type { ReporteCostos } from "./mes";

const NAVY = "#0A559A";
const NARANJA = "#DE8C11";
const GRIS = "#6B7280";
const LINEA = "#E5E7EB";
const FUENTE = "Helvetica, Arial, sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const montoMx = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesos = (n: number) => `$${montoMx.format(n)}`;

// Monto principal (pesos si hay tipo de cambio) y el secundario en dólares, o solo dólares.
function montos(usd: number | null, mxn: number | null): { principal: string; secundario: string | null } {
  if (usd === null) return { principal: "sin dato", secundario: null };
  if (mxn === null) return { principal: formatUsd(usd), secundario: null };
  return { principal: pesos(mxn), secundario: formatUsd(usd) };
}

export function asuntoCorreo(r: ReporteCostos): string {
  const total = r.totalMxn === null ? formatUsd(r.totalUsd) : `${pesos(r.totalMxn)} (${formatUsd(r.totalUsd)})`;
  return `Costos del CRM · ${r.mes.nombre} · ${total}`;
}

export function htmlCorreo(r: ReporteCostos): string {
  const celda = `padding:10px 8px;border-bottom:1px solid ${LINEA};vertical-align:top;`;
  const filas = r.renglones
    .map((x) => {
      const m = montos(x.usd, x.mxn);
      return `<tr>
  <td style="${celda}"><div style="font-weight:bold;color:#111827;">${esc(x.servicio)}</div><div style="color:${GRIS};font-size:13px;">${esc(x.paraQue)}</div>${
    x.nota ? `<div style="color:${GRIS};font-size:12px;margin-top:2px;">${esc(x.nota)}</div>` : ""
  }</td>
  <td style="${celda}text-align:right;white-space:nowrap;"><div style="color:${x.usd === null ? GRIS : "#111827"};">${m.principal}</div>${
    m.secundario ? `<div style="color:${GRIS};font-size:12px;">${m.secundario}</div>` : ""
  }</td>
</tr>`;
    })
    .join("\n");

  const t = montos(r.totalUsd, r.totalMxn);
  const total = `<tr>
  <td style="padding:12px 8px;font-weight:bold;color:${NAVY};vertical-align:top;">Total${r.sinDato.length ? ` <span style="font-weight:normal;color:${GRIS};font-size:12px;">(sin ${esc(r.sinDato.join(", "))})</span>` : ""}</td>
  <td style="padding:12px 8px;text-align:right;white-space:nowrap;"><div style="font-weight:bold;color:${NAVY};">${t.principal}</div>${
    t.secundario ? `<div style="color:${GRIS};font-size:12px;">${t.secundario}</div>` : ""
  }</td>
</tr>`;

  let ventas = "";
  if (r.ventas !== null) {
    const porVenta = r.costoPorVentaUsd === null ? null : montos(r.costoPorVentaUsd, r.costoPorVentaMxn);
    ventas = `<p style="margin:16px 0 0;color:#111827;">Ventas del mes: <b>${r.ventas.toLocaleString("es-MX")}</b>${
      porVenta ? ` · Costo del CRM por venta: <b>${porVenta.principal}</b>${porVenta.secundario ? ` <span style="color:${GRIS};">(${porVenta.secundario})</span>` : ""}` : ""
    }</p>`;
  }

  const tipoCambio = r.tipoCambio
    ? `<p style="margin:6px 0 0;color:${GRIS};font-size:12px;">Dólar a ${pesos(r.tipoCambio.mxnPorUsd)} (promedio de ${esc(r.mes.nombre.replace(/ de \d{4}$/, ""))}, Diario Oficial).</p>`
    : "";

  const nota = r.nota
    ? `<div style="margin:12px 0 4px;padding:10px 12px;border-left:4px solid ${NAVY};background:#F3F6FA;color:#111827;font-size:14px;">${esc(r.nota)}</div>`
    : "";

  const avisos = r.avisos.length
    ? `<div style="margin:16px 0 0;padding:10px 12px;border-left:4px solid ${NARANJA};background:#FFF7EB;color:#111827;font-size:14px;">${r.avisos
        .map((a) => `<div>${esc(a)}</div>`)
        .join("")}</div>`
    : "";

  const encabezado = r.totalMxn === null ? formatUsd(r.totalUsd) : pesos(r.totalMxn);
  const encabezadoUsd = r.totalMxn === null ? "" : `<div style="font-size:14px;opacity:0.85;margin-top:2px;">${formatUsd(r.totalUsd)}</div>`;

  return `<div style="font-family:${FUENTE};max-width:560px;margin:0 auto;color:#111827;font-size:15px;line-height:1.4;">
<div style="background:${NAVY};color:#FFFFFF;padding:16px;border-radius:8px 8px 0 0;">
  <div style="font-size:13px;opacity:0.85;">Costos del CRM · ${esc(r.organizacion)}</div>
  <div style="font-size:22px;font-weight:bold;margin-top:4px;">${esc(r.mes.nombre)}: ${encabezado}</div>
  ${encabezadoUsd}
</div>
${nota}
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-family:${FUENTE};font-size:15px;">
${filas}
${total}
</table>
${ventas}
${tipoCambio}
${avisos}
</div>`;
}
