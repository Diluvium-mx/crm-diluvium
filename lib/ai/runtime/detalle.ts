// Autollenado del Detalle del contacto por el Agente IA (parte 1, 26-sep-2026).
// Sale en la MISMA llamada que genera la respuesta (herramienta `actualizar_detalle`,
// tools.ts), sin llamada extra. Reglas del dueño:
// - el agente solo llena campos VACÍOS o que él mismo llenó antes; nunca borra ni
//   cambia lo que escribió un vendedor (origen por campo en custom_fields.detalle_por,
//   lib/contacts/qualification.ts). Un campo editado por un vendedor es suyo para siempre;
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
    // ¿Puede escribir el agente? Vacío o suyo, y nunca si un vendedor lo tocó.
    const can = (key: string, current: unknown) => {
      if (por[key] === "vendedor" || (current !== null && por[key] !== "agente")) {
        out.delVendedor.push(key);
        return false;
      }
      return true;
    };
    const d = pedido.campos;
    const patch: ContactQualificationPatch = {};
    if (d.tieneInundaciones !== undefined && d.tieneInundaciones !== c.tieneInundaciones && can(DETALLE_KEY.tieneInundaciones, c.tieneInundaciones)) {
      patch.tieneInundaciones = d.tieneInundaciones;
    }
    if (d.nivelAguaCm !== undefined && d.nivelAguaCm !== c.nivelAguaCm && can(DETALLE_KEY.nivelAguaCm, c.nivelAguaCm)) patch.nivelAguaCm = d.nivelAguaCm;
    if (d.nivelAguaTexto !== undefined && d.nivelAguaTexto !== c.nivelAguaTexto && can(DETALLE_KEY.nivelAguaTexto, c.nivelAguaTexto)) {
      patch.nivelAguaTexto = d.nivelAguaTexto;
    }
    if (
      d.porcentajeConvencimiento !== undefined &&
      d.porcentajeConvencimiento !== c.porcentajeConvencimiento &&
      can(DETALLE_KEY.porcentajeConvencimiento, c.porcentajeConvencimiento)
    ) {
      patch.porcentajeConvencimiento = d.porcentajeConvencimiento;
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
    if (wantN !== undefined && wantN !== n && can(DETALLE_KEY.numEntradas, n)) {
      // Bajar el número borra filas: solo si ninguna de las que se irían tiene algo que
      // no sea del agente (un ancho o un tamaño que escribió un vendedor no se borra).
      const leaving = (await readEntradas()).filter((e) => e.posicion > wantN);
      const safe = leaving.every(
        (e) =>
          (e.anchoCm === null || por[entradaKey(e.posicion, "ancho")] === "agente") &&
          e.tamanoManual === null &&
          por[entradaKey(e.posicion, "linea")] !== "vendedor",
      );
      if (safe) {
        await setNumEntradas(tx, organizationId, contactId, wantN, AGENTE_IA);
        out.llenados.push(DETALLE_KEY.numEntradas);
        n = wantN;
      } else {
        out.delVendedor.push(DETALLE_KEY.numEntradas);
      }
    }
    if (d.anchosCm && n) {
      const rows = await readEntradas();
      for (let i = 0; i < Math.min(d.anchosCm.length, n); i++) {
        const posicion = i + 1;
        const row = rows.find((r) => r.posicion === posicion);
        if (!row || row.anchoCm === d.anchosCm[i]) continue;
        if (!can(entradaKey(posicion, "ancho"), row.anchoCm)) continue;
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
    })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!c) return "";
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
  if (c.tieneInundaciones) partes.push(`inundaciones: ${INUNDACIONES_LABEL[c.tieneInundaciones]}`);
  if (c.nivelAguaCm !== null || c.nivelAguaTexto) {
    partes.push(`agua: ${[c.nivelAguaCm !== null ? `${c.nivelAguaCm} cm` : "", c.nivelAguaTexto ? `(${c.nivelAguaTexto})` : ""].filter(Boolean).join(" ")}`);
  }
  if (c.numEntradas !== null) {
    const anchos = entradas.map((e) => e.anchoCm).filter((a): a is number => a !== null);
    partes.push(`entradas: ${c.numEntradas}${anchos.length ? ` (anchos: ${anchos.join(", ")} cm)` : ""}`);
  }
  if (c.porcentajeConvencimiento !== null) partes.push(`convencimiento: ${c.porcentajeConvencimiento} %`);
  const lines = [`Detalle guardado del contacto: ${partes.length ? partes.join(" · ") : "vacío"}.`];
  if (propios.length) lines.push(`Comentarios que ya guardaste: ${propios.map((p) => `«${p.body.slice(0, 150)}»`).join(" · ")}.`);
  return lines.join("\n");
}
