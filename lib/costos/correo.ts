// Correo mensual de costos (docs/costos.md): asunto y cuerpo HTML a partir del reporte. PURO. Estilo de la marca
// (navy, Helvetica; naranja solo para avisos) con estilos en línea, que es lo único que respetan Gmail y Zoho.
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

const usd = (n: number | null) => (n === null ? "sin dato" : formatUsd(n));

export function asuntoCorreo(r: ReporteCostos): string {
  return `Costos del CRM · ${r.mes.nombre} · ${formatUsd(r.totalUsd)}`;
}

export function htmlCorreo(r: ReporteCostos): string {
  const celda = `padding:10px 8px;border-bottom:1px solid ${LINEA};vertical-align:top;`;
  const filas = r.renglones
    .map(
      (x) => `<tr>
  <td style="${celda}"><div style="font-weight:bold;color:#111827;">${esc(x.servicio)}</div><div style="color:${GRIS};font-size:13px;">${esc(x.paraQue)}</div>${
    x.nota ? `<div style="color:${GRIS};font-size:12px;margin-top:2px;">${esc(x.nota)}</div>` : ""
  }</td>
  <td style="${celda}text-align:right;white-space:nowrap;color:${x.usd === null ? GRIS : "#111827"};">${usd(x.usd)}</td>
</tr>`,
    )
    .join("\n");

  const total = `<tr>
  <td style="padding:12px 8px;font-weight:bold;color:${NAVY};">Total${r.sinDato.length ? ` <span style="font-weight:normal;color:${GRIS};font-size:12px;">(sin ${esc(r.sinDato.join(", "))})</span>` : ""}</td>
  <td style="padding:12px 8px;text-align:right;font-weight:bold;color:${NAVY};white-space:nowrap;">${formatUsd(r.totalUsd)}</td>
</tr>`;

  const ventas =
    r.ventas === null
      ? ""
      : `<p style="margin:16px 0 0;color:#111827;">Ventas del mes: <b>${r.ventas.toLocaleString("es-MX")}</b>${
          r.costoPorVentaUsd !== null ? ` · Costo del CRM por venta: <b>${formatUsd(r.costoPorVentaUsd)}</b>` : ""
        }</p>`;

  const avisos = r.avisos.length
    ? `<div style="margin:16px 0 0;padding:10px 12px;border-left:4px solid ${NARANJA};background:#FFF7EB;color:#111827;font-size:14px;">${r.avisos
        .map((a) => `<div>${esc(a)}</div>`)
        .join("")}</div>`
    : "";

  return `<div style="font-family:${FUENTE};max-width:560px;margin:0 auto;color:#111827;font-size:15px;line-height:1.4;">
<div style="background:${NAVY};color:#FFFFFF;padding:16px;border-radius:8px 8px 0 0;">
  <div style="font-size:13px;opacity:0.85;">Costos del CRM · ${esc(r.organizacion)}</div>
  <div style="font-size:22px;font-weight:bold;margin-top:4px;">${esc(r.mes.nombre)}: ${formatUsd(r.totalUsd)}</div>
</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-family:${FUENTE};font-size:15px;">
${filas}
${total}
</table>
${ventas}
${avisos}
<p style="margin:20px 0 0;color:${GRIS};font-size:12px;">Montos en dólares. IA, Railway y Zernio: lo que cobró cada servicio. Meta: estimado del CRM mientras Meta no da su cobro. Correo automático del CRM, el día 3 de cada mes.</p>
</div>`;
}
