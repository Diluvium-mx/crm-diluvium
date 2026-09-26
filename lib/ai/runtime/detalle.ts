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
// - sus comentarios van firmados por "Agente IA" (usuario de sistema, 0037).
// Nunca lanza hacia afuera: el Detalle es de apoyo y no debe frenar la respuesta.
// Multi-tenant (CLAUDE.md §7): todo filtra por organization_id.
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema/contacts";
import { contactComentarios, contactEntradas } from "@/lib/db/schema/qualification";
import {
  addComment,
  AGENT_AI_USER_ID,
  DETALLE_KEY,
  detallePorOf,
  entradaKey,
  setNumEntradas,
  updateContactQualification,
  updateEntrada,
  type ContactQualificationPatch,
} from "@/lib/contacts/qualification";
import { normalizeSearch } from "@/lib/text/search";
import type { DetalleIa, ValidToolCall } from "./tools";

export const MAX_COMENTARIOS_POR_RESPUESTA = 2;
// Quién escribe (aviso en vivo "contacto actualizado") y, con ello, el origen "agente".
const AGENTE_IA = { kind: "agente" } as const;

export type DetallePedido = { campos: Omit<DetalleIa, "comentario">; comentarios: string[] };

// Varias llamadas en una respuesta: gana el último valor de cada campo; los
// comentarios se juntan (sin repetir, máximo 2).
export function mergeDetalle(calls: readonly ValidToolCall[]): DetallePedido | null {
  const campos: Omit<DetalleIa, "comentario"> = {};
  const comentarios: string[] = [];
  let any = false;
  for (const c of calls) {
    if (c.kind !== "detalle") continue;
    any = true;
    const { comentario, ...rest } = c.detalle;
    Object.assign(campos, rest);
    if (comentario && !comentarios.some((x) => normalizeSearch(x) === normalizeSearch(comentario))) comentarios.push(comentario);
  }
  return any ? { campos, comentarios: comentarios.slice(0, MAX_COMENTARIOS_POR_RESPUESTA) } : null;
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
    if (d.tieneInundaciones !== undefined && d.tieneInundaciones !== c.tieneInundaciones) {
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

    // Comentarios firmados por "Agente IA", sin repetir uno ya guardado (de quien sea).
    // Cada uno en su punto de guardado: si falla, lo demás del Detalle se queda.
    if (pedido.comentarios.length) {
      const existing = await tx
        .select({ body: contactComentarios.body })
        .from(contactComentarios)
        .where(and(eq(contactComentarios.organizationId, organizationId), eq(contactComentarios.contactId, contactId)));
      const seen = new Set(existing.map((e) => normalizeSearch(e.body)));
      for (const body of pedido.comentarios) {
        if (seen.has(normalizeSearch(body))) continue;
        try {
          await tx.transaction((sp) => addComment(sp, organizationId, contactId, AGENT_AI_USER_ID, body));
          seen.add(normalizeSearch(body));
          out.llenados.push("comentario");
        } catch (error) {
          console.error(`[agente] comentario del Detalle no guardado (${contactId})`, error);
        }
      }
    }
  });
  return out;
}

// Lo que ya dice el Detalle, para el contexto del CRM del último turno del cliente
// (no en el system: la caché del prompt se mantiene). Solo los comentarios del PROPIO
// agente: las notas internas de los vendedores no se le pasan al modelo (podría
// repetírselas al cliente).
const INUNDACIONES_LABEL = { si: "sí", no: "no", no_sabe: "no sabe" } as const;
export const MAX_COMENTARIOS_EN_CONTEXTO = 5;

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
  const [entradas, propios] = await Promise.all([
    db
      .select({ anchoCm: contactEntradas.anchoCm })
      .from(contactEntradas)
      .where(and(eq(contactEntradas.organizationId, organizationId), eq(contactEntradas.contactId, contactId)))
      .orderBy(asc(contactEntradas.posicion)),
    db
      .select({ body: contactComentarios.body })
      .from(contactComentarios)
      .where(
        and(
          eq(contactComentarios.organizationId, organizationId),
          eq(contactComentarios.contactId, contactId),
          eq(contactComentarios.authorUserId, AGENT_AI_USER_ID),
        ),
      )
      .orderBy(desc(contactComentarios.createdAt))
      .limit(MAX_COMENTARIOS_EN_CONTEXTO),
  ]);
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
  if (propios.length) lines.push(`Comentarios que ya guardaste: ${propios.map((p) => `«${p.body.slice(0, 150)}»`).join(" · ")}.`);
  return lines.join("\n");
}
