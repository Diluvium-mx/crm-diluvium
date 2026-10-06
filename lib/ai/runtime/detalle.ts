// Autollenado del Detalle del contacto por el Agente IA (parte 1, 26-sep-2026).
// Sale en la MISMA llamada que genera la respuesta (herramienta `actualizar_detalle`,
// tools.ts), sin llamada extra. Reglas del dueño (26-sep-2026, tras probarlo):
// - ningún dato es definitivo, ni el del vendedor ni el del agente: el agente sigue
//   leyendo TODA la conversación y, si un dato guardado ya no cuadra con lo que dijo el
//   cliente (p. ej. al final son 2 entradas y no 1), lo corrige. Una edición del vendedor
//   es "una acción más". El origen por campo (custom_fields.detalle_por) solo dice quién
//   escribió al último: pinta la marca "IA" y le avisa al modelo qué corrigió un vendedor;
// - escribe SIEMPRE con las funciones de lib/contacts/qualification.ts (así el aviso
//   "contacto actualizado" en vivo las cubre igual que a un vendedor);
// - sin comentarios (6-oct-2026, dueño): la sección Comentarios del Detalle se quitó porque
//   ningún vendedor la veía; el Agente IA y el lector ya no los escriben ni los leen.
// Nunca lanza hacia afuera: el Detalle es de apoyo y no debe frenar la respuesta.
// Multi-tenant (CLAUDE.md §7): todo filtra por organization_id.
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema/contacts";
import { contactEntradas } from "@/lib/db/schema/qualification";
import {
  DETALLE_KEY,
  detallePorOf,
  entradaKey,
  setNumEntradas,
  updateContactQualification,
  updateEntrada,
  type ContactQualificationPatch,
} from "@/lib/contacts/qualification";
import type { DetalleIa, ValidToolCall } from "./tools";

// Quién escribe (aviso en vivo "contacto actualizado") y, con ello, el origen "agente".
const AGENTE_IA = { kind: "agente" } as const;

export type DetallePedido = { campos: DetalleIa };

// Varias llamadas en una respuesta: gana el último valor de cada campo.
export function mergeDetalle(calls: readonly ValidToolCall[]): DetallePedido | null {
  const campos: DetalleIa = {};
  let any = false;
  for (const c of calls) {
    if (c.kind !== "detalle") continue;
    any = true;
    Object.assign(campos, c.detalle);
  }
  return any ? { campos } : null;
}

// `delVendedor`: campos que el agente corrigió sobre lo último que puso un vendedor (log).
export type DetalleResultado = { llenados: string[]; delVendedor: string[] };

export async function applyDetalleByAgent(organizationId: string, contactId: string, pedido: DetallePedido): Promise<DetalleResultado> {
  const out: DetalleResultado = { llenados: [], delVendedor: [] };
  await db.transaction(async (tx) => {
    // La fila del contacto queda bloqueada hasta el final: un vendedor que guarda al mismo
    // tiempo espera y su valor (marcado "vendedor") queda encima del del agente.
    const [c] = await tx
      .select({
        tieneInundaciones: contacts.tieneInundaciones,
        nivelAguaCm: contacts.nivelAguaCm,
        nivelAguaTexto: contacts.nivelAguaTexto,
        numEntradas: contacts.numEntradas,
        porcentajeConvencimiento: contacts.porcentajeConvencimiento,
        customFields: contacts.customFields,
      })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
      .limit(1)
      .for("update");
    if (!c) return;
    const por = detallePorOf(c.customFields);
    // Registro (log): campos que corrige sobre lo que había puesto un vendedor.
    const note = (key: string) => {
      if (por[key] === "vendedor") out.delVendedor.push(key);
    };
    const d = pedido.campos;
    const patch: ContactQualificationPatch = {};
    // "No sabe" nunca borra un sí/no que ya dijo el cliente (el modelo lo usaba de relleno).
    const bajaANoSabe = d.tieneInundaciones === "no_sabe" && (c.tieneInundaciones === "si" || c.tieneInundaciones === "no");
    if (d.tieneInundaciones !== undefined && d.tieneInundaciones !== c.tieneInundaciones && !bajaANoSabe) {
      patch.tieneInundaciones = d.tieneInundaciones;
      note(DETALLE_KEY.tieneInundaciones);
    }
    if (d.nivelAguaCm !== undefined && d.nivelAguaCm !== c.nivelAguaCm) {
      patch.nivelAguaCm = d.nivelAguaCm;
      note(DETALLE_KEY.nivelAguaCm);
    }
    if (d.nivelAguaTexto !== undefined && d.nivelAguaTexto !== c.nivelAguaTexto) {
      patch.nivelAguaTexto = d.nivelAguaTexto;
      note(DETALLE_KEY.nivelAguaTexto);
    }
    if (d.porcentajeConvencimiento !== undefined && d.porcentajeConvencimiento !== c.porcentajeConvencimiento) {
      patch.porcentajeConvencimiento = d.porcentajeConvencimiento;
      note(DETALLE_KEY.porcentajeConvencimiento);
    }
    if (Object.keys(patch).length) {
      await updateContactQualification(tx, organizationId, contactId, patch, AGENTE_IA);
      out.llenados.push(...Object.keys(patch));
    }

    // Entradas: el número (si el cliente no lo dijo, lo dan los anchos) y un ancho por
    // entrada; el tamaño sugerido lo calcula updateEntrada (suggestSize).
    const readEntradas = () =>
      tx
        .select({ posicion: contactEntradas.posicion, anchoCm: contactEntradas.anchoCm, tamanoManual: contactEntradas.tamanoManual })
        .from(contactEntradas)
        .where(and(eq(contactEntradas.organizationId, organizationId), eq(contactEntradas.contactId, contactId)))
        .orderBy(asc(contactEntradas.posicion));
    let n = c.numEntradas;
    const wantN = d.numEntradas ?? (d.anchosCm ? Math.max(d.anchosCm.length, n ?? 0) : undefined);
    if (wantN !== undefined && wantN !== n) {
      // Bajar el número borra las entradas de más (el cliente cambió de idea).
      note(DETALLE_KEY.numEntradas);
      await setNumEntradas(tx, organizationId, contactId, wantN, AGENTE_IA);
      out.llenados.push(DETALLE_KEY.numEntradas);
      n = wantN;
    }
    if (d.anchosCm && n) {
      const rows = await readEntradas();
      for (let i = 0; i < Math.min(d.anchosCm.length, n); i++) {
        const posicion = i + 1;
        const row = rows.find((r) => r.posicion === posicion);
        if (!row || row.anchoCm === d.anchosCm[i]) continue;
        note(entradaKey(posicion, "ancho"));
        await updateEntrada(tx, organizationId, contactId, posicion, { anchoCm: d.anchosCm[i] }, AGENTE_IA);
        out.llenados.push(entradaKey(posicion, "ancho"));
      }
    }
  });
  return out;
}

// Lo que ya dice el Detalle, para el contexto del CRM del último turno del cliente
// (no en el system: la caché del prompt se mantiene).
const INUNDACIONES_LABEL = { si: "sí", no: "no", no_sabe: "no sabe" } as const;

export async function detalleContextFor(organizationId: string, contactId: string): Promise<string> {
  const [c] = await db
    .select({
      tieneInundaciones: contacts.tieneInundaciones,
      nivelAguaCm: contacts.nivelAguaCm,
      nivelAguaTexto: contacts.nivelAguaTexto,
      numEntradas: contacts.numEntradas,
      porcentajeConvencimiento: contacts.porcentajeConvencimiento,
      customFields: contacts.customFields,
    })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!c) return "";
  // Lo que corrigió un vendedor al último se le dice al modelo: no es definitivo (si el
  // cliente dice otra cosa, lo corrige), pero pudo saberlo por teléfono.
  const por = detallePorOf(c.customFields);
  const v = (...keys: string[]) => (keys.some((k) => por[k] === "vendedor") ? " (lo corrigió un vendedor)" : "");
  const entradas = await db
    .select({ anchoCm: contactEntradas.anchoCm })
    .from(contactEntradas)
    .where(and(eq(contactEntradas.organizationId, organizationId), eq(contactEntradas.contactId, contactId)))
    .orderBy(asc(contactEntradas.posicion));
  const partes: string[] = [];
  if (c.tieneInundaciones) partes.push(`inundaciones: ${INUNDACIONES_LABEL[c.tieneInundaciones]}${v(DETALLE_KEY.tieneInundaciones)}`);
  if (c.nivelAguaCm !== null || c.nivelAguaTexto) {
    partes.push(
      `agua: ${[c.nivelAguaCm !== null ? `${c.nivelAguaCm} cm` : "", c.nivelAguaTexto ? `(${c.nivelAguaTexto})` : ""].filter(Boolean).join(" ")}${v(DETALLE_KEY.nivelAguaCm, DETALLE_KEY.nivelAguaTexto)}`,
    );
  }
  if (c.numEntradas !== null) {
    const anchos = entradas.map((e) => e.anchoCm).filter((a): a is number => a !== null);
    const anchosVendedor = entradas.map((_, i) => entradaKey(i + 1, "ancho"));
    partes.push(`entradas: ${c.numEntradas}${anchos.length ? ` (anchos: ${anchos.join(", ")} cm)` : ""}${v(DETALLE_KEY.numEntradas, ...anchosVendedor)}`);
  }
  if (c.porcentajeConvencimiento !== null) partes.push(`convencimiento: ${c.porcentajeConvencimiento} %`);
  const lines = [`Detalle guardado del contacto: ${partes.length ? partes.join(" · ") : "vacío"}.`];
  return lines.join("\n");
}
