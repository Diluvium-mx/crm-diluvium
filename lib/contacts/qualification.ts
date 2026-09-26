import { and, asc, desc, eq, gt, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { member, user } from "@/lib/db/schema/auth";
import { contacts, contactInundacionesEnum } from "@/lib/db/schema/contacts";
import {
  contactComentarios,
  contactEntradas,
  tallasCompuerta,
} from "@/lib/db/schema/qualification";
import {
  suggestSize,
  validateSizeRanges,
  type LineaCompuerta,
  type SizeRange,
} from "./sizes";
import { isInternalAgentTag } from "@/lib/ai/runtime/tags";
import { conversations, messages } from "@/lib/db/schema/messaging";
import { sanitizeReferral } from "@/lib/inbox/format";
import { contactAdAttribution } from "@/lib/ads/queries";
import { roleAllows } from "@/lib/auth/permissions";
import { notifyContactUpdated, type ContactActor, type ContactChange } from "./notify-updated";

// La conexión principal y las transacciones comparten esta interfaz. Así estas
// funciones sirven igual para Server Actions y para procesos futuros del agente IA.
type Database = Omit<typeof import("@/lib/db").db, "$client">;
type TieneInundaciones = (typeof contactInundacionesEnum.enumValues)[number];

export type ContactQualificationPatch = Partial<{
  tieneInundaciones: TieneInundaciones | null;
  nivelAguaCm: number | null;
  nivelAguaTexto: string | null;
  montoCotizacion: number | null;
  porcentajeConvencimiento: number | null;
}>;

export type EntradaPatch = Partial<{
  anchoCm: number | null;
  linea: LineaCompuerta;
  tamanoManual: string | null;
}>;

export type CommentActor = {
  userId: string;
  role: string;
};

// Quién escribe en el Detalle. Toda escritura de aquí manda el aviso en vivo
// (contact.updated, lib/contacts/notify-updated.ts) dentro de su transacción, así
// el Detalle abierto en otra pantalla se pone al día solo. Las Server Actions del
// vendedor pasan el suyo; sin `by` lo escribió el Agente IA (autollenado).
const AGENTE: ContactActor = { kind: "agente" };

// ── Origen por campo del Detalle (Agente IA parte 1, 26-sep-2026) ──────────────
// contacts.custom_fields.detalle_por = { <campo>: "agente" | "vendedor" }. El agente
// solo llena campos VACÍOS o que él mismo llenó; en cuanto un vendedor edita un campo,
// ese campo queda "vendedor" para siempre y el agente ya no lo toca. Campos: los de
// DETALLE_KEY y, por entrada, entrada_<n>_ancho | entrada_<n>_linea | entrada_<n>_tamano.
// La escritura va en la MISMA sentencia que el valor (o antes, en updateEntrada).
export type DetalleOrigen = "agente" | "vendedor";
export const DETALLE_POR = "detalle_por";
export const DETALLE_KEY = {
  tieneInundaciones: "tiene_inundaciones",
  nivelAguaCm: "nivel_agua_cm",
  nivelAguaTexto: "nivel_agua_texto",
  porcentajeConvencimiento: "porcentaje_convencimiento",
  numEntradas: "num_entradas",
} as const;
export const entradaKey = (posicion: number, campo: "ancho" | "linea" | "tamano") => `entrada_${posicion}_${campo}`;
// Autor de SISTEMA de los comentarios del agente (migración 0037): no es miembro.
export const AGENT_AI_USER_ID = "usuario-sistema-agente-ia";

export function detallePorOf(customFields: unknown): Record<string, DetalleOrigen> {
  const raw = (customFields as Record<string, unknown> | null)?.[DETALLE_POR];
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, DetalleOrigen> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === "agente" || v === "vendedor") out[k] = v;
  return out;
}

// custom_fields con el origen de `keys` fijado (sobre la expresión `base`).
function withDetallePor(base: SQL, keys: readonly string[], origen: DetalleOrigen): SQL {
  const marks = JSON.stringify(Object.fromEntries(keys.map((k) => [k, origen])));
  return sql`jsonb_set(coalesce(${base}, '{}'::jsonb), '{${sql.raw(DETALLE_POR)}}', coalesce((${base})->'${sql.raw(DETALLE_POR)}', '{}'::jsonb) || ${marks}::jsonb)`;
}

// El origen lo da QUIÉN escribe (`by`, el mismo del aviso en vivo): vendedor → "vendedor"
// (el campo es suyo para siempre), Agente IA → "agente"; una automatización no marca.
function origenOf(by: ContactActor): DetalleOrigen | undefined {
  return by.kind === "vendedor" ? "vendedor" : by.kind === "agente" ? "agente" : undefined;
}

async function requireContact(
  database: Database,
  organizationId: string,
  contactId: string,
): Promise<typeof contacts.$inferSelect> {
  const [contact] = await database
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);

  if (!contact) {
    throw new Error("Contacto no encontrado en esta organización.");
  }
  return contact;
}

function cleanCommentBody(body: string): string {
  const cleaned = body.trim();
  if (cleaned.length < 1 || cleaned.length > 5000) {
    throw new Error("El comentario debe tener entre 1 y 5000 caracteres.");
  }
  return cleaned;
}

// El autor, o cualquier rol con permiso de editar contactos (hoy owner, admin y
// vendedor: el vendedor tiene todo menos Configuración, decisión del 26-sep-2026).
// Un rol desconocido solo toca los suyos (falla cerrado).
function canModifyComment(actor: CommentActor, authorUserId: string): boolean {
  return actor.userId === authorUserId || roleAllows(actor.role, "contact", "update");
}

// Resumen del anuncio por el que llegó el contacto: el del filtro (Luna) guardado en
// el primer entrante con anuncio; si Luna aún no lo procesó (p. ej. el agente está
// apagado en ese canal), el título y el texto del anuncio. null = no llegó por anuncio.
async function adSummary(database: Database, organizationId: string, contactId: string): Promise<string | null> {
  const [row] = await database
    .select({ adReferral: messages.adReferral, metadata: messages.metadata })
    .from(messages)
    .innerJoin(
      conversations,
      and(eq(conversations.id, messages.conversationId), eq(conversations.organizationId, organizationId)),
    )
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(conversations.contactId, contactId),
        eq(messages.direction, "in"),
        or(isNotNull(messages.adReferral), sql`${messages.metadata} ? 'agenteAnuncio'`),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(1);
  if (!row) return null;
  const luna = (row.metadata as { agenteAnuncio?: { anuncio?: unknown } } | null)?.agenteAnuncio?.anuncio;
  if (typeof luna === "string" && luna.trim()) return luna.trim();
  const ad = sanitizeReferral(row.adReferral);
  if (!ad) return null;
  return [ad.headline, ad.body].filter(Boolean).join(" — ").slice(0, 200) || null;
}

export async function getContactQualification(
  database: Database,
  organizationId: string,
  contactId: string,
) {
  const contact = await requireContact(database, organizationId, contactId);
  const [entradas, comentarios, anuncio, anuncios] = await Promise.all([
    database
      .select({
        id: contactEntradas.id,
        posicion: contactEntradas.posicion,
        anchoCm: contactEntradas.anchoCm,
        linea: contactEntradas.linea,
        tamanoSugerido: contactEntradas.tamanoSugerido,
        tamanoManual: contactEntradas.tamanoManual,
      })
      .from(contactEntradas)
      .where(
        and(
          eq(contactEntradas.organizationId, organizationId),
          eq(contactEntradas.contactId, contactId),
        ),
      )
      .orderBy(asc(contactEntradas.posicion)),
    database
      .select({
        id: contactComentarios.id,
        body: contactComentarios.body,
        createdAt: contactComentarios.createdAt,
        updatedAt: contactComentarios.updatedAt,
        authorId: user.id,
        authorName: user.name,
      })
      .from(contactComentarios)
      .innerJoin(user, eq(user.id, contactComentarios.authorUserId))
      .where(
        and(
          eq(contactComentarios.organizationId, organizationId),
          eq(contactComentarios.contactId, contactId),
        ),
      )
      .orderBy(desc(contactComentarios.createdAt)),
    adSummary(database, organizationId, contactId),
    contactAdAttribution(organizationId, contactId),
  ]);

  return {
    // Resumen corto del anuncio de Click-to-WhatsApp por el que llegó (lo deja Luna).
    anuncio,
    // Anuncio (nombre de Meta + enlace a su página) por el que llegó primero y
    // los otros por los que volvió. null = no llegó por anuncio.
    anuncios: anuncios
      ? {
          first: { name: anuncios.first.name, href: anuncios.first.href },
          others: anuncios.others.map((o) => ({ name: o.name, href: o.href })),
        }
      : null,
    // Datos básicos que el panel muestra al final (compactos).
    email: contact.email,
    // Sin las etiquetas internas del agente ("pasar a humano", "revisión humana").
    tags: contact.tags.filter((t) => !isInternalAgentTag(t)),
    tieneInundaciones: contact.tieneInundaciones,
    nivelAguaCm: contact.nivelAguaCm,
    nivelAguaTexto: contact.nivelAguaTexto,
    numEntradas: contact.numEntradas,
    montoCotizacion:
      contact.montoCotizacion === null ? null : Number(contact.montoCotizacion),
    porcentajeConvencimiento: contact.porcentajeConvencimiento,
    // Campos que llenó el Agente IA y ningún vendedor ha editado (marca "IA" en el Detalle).
    // El monto lo fija el agente con fijar_cotizacion (custom_fields.cotizacion_por).
    iaFields: [
      ...Object.entries(detallePorOf(contact.customFields))
        .filter(([, origen]) => origen === "agente")
        .map(([key]) => key),
      ...((contact.customFields as Record<string, unknown> | null)?.cotizacion_por === "agente" ? ["monto_cotizacion"] : []),
      // La etapa la movió el Agente IA (mover_etapa); un vendedor que la cambie la hace suya.
      ...(contact.stageChangedBy === "agente" ? ["etapa"] : []),
    ],
    entradas,
    comentarios: comentarios.map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: { id: comment.authorId, name: comment.authorName },
    })),
  };
}

export async function updateContactQualification(
  database: Database,
  organizationId: string,
  contactId: string,
  patch: ContactQualificationPatch,
  by: ContactActor = AGENTE,
): Promise<void> {
  const values: Partial<typeof contacts.$inferInsert> = {};
  const origenKeys: string[] = [];
  const origen = origenOf(by);

  if (Object.prototype.hasOwnProperty.call(patch, "tieneInundaciones")) {
    values.tieneInundaciones = patch.tieneInundaciones;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "nivelAguaCm")) {
    values.nivelAguaCm = patch.nivelAguaCm;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "nivelAguaTexto")) {
    values.nivelAguaTexto = patch.nivelAguaTexto;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "montoCotizacion")) {
    values.montoCotizacion =
      patch.montoCotizacion === null ? null : String(patch.montoCotizacion);
    // Fijado a mano por un vendedor: el agente ya no lo pisa (fijar_cotizacion
    // solo escribe si está vacío o lo puso el propio agente).
    values.customFields = sql`${contacts.customFields} || '{"cotizacion_por":"vendedor"}'::jsonb`;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "porcentajeConvencimiento")) {
    values.porcentajeConvencimiento = patch.porcentajeConvencimiento;
  }
  if (origen) {
    for (const field of ["tieneInundaciones", "nivelAguaCm", "nivelAguaTexto", "porcentajeConvencimiento"] as const) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) origenKeys.push(DETALLE_KEY[field]);
    }
    if (origenKeys.length) {
      values.customFields = withDetallePor(
        (values.customFields as SQL | undefined) ?? sql`${contacts.customFields}`,
        origenKeys,
        origen,
      );
    }
  }

  if (Object.keys(values).length === 0) {
    await requireContact(database, organizationId, contactId);
    return;
  }

  const changes: ContactChange[] = [];
  if ("montoCotizacion" in values) changes.push("cotizacion");
  if (Object.keys(values).some((key) => key !== "montoCotizacion" && key !== "customFields")) changes.push("detalle");

  const updated = await database.transaction(async (tx) => {
    const [row] = await tx
      .update(contacts)
      .set(values)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
      .returning({ id: contacts.id });
    if (row) await notifyContactUpdated(tx, { organizationId, contactId, changes, by });
    return row;
  });

  if (!updated) {
    throw new Error("Contacto no encontrado en esta organización.");
  }
}

export async function setNumEntradas(
  database: Database,
  organizationId: string,
  contactId: string,
  n: number | null,
  by: ContactActor = AGENTE,
): Promise<void> {
  if (n !== null && (!Number.isInteger(n) || n < 0 || n > 50)) {
    throw new Error("El número de entradas debe ser un entero entre 0 y 50.");
  }
  const origen = origenOf(by);

  await database.transaction(async (tx) => {
    const [contact] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
      .limit(1)
      .for("update");

    if (!contact) {
      throw new Error("Contacto no encontrado en esta organización.");
    }

    await tx
      .update(contacts)
      .set({
        numEntradas: n,
        ...(origen ? { customFields: withDetallePor(sql`${contacts.customFields}`, [DETALLE_KEY.numEntradas], origen) } : {}),
      })
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
    await notifyContactUpdated(tx, { organizationId, contactId, changes: ["detalle"], by });

    if (n === null || n === 0) {
      await tx
        .delete(contactEntradas)
        .where(
          and(
            eq(contactEntradas.organizationId, organizationId),
            eq(contactEntradas.contactId, contactId),
          ),
        );
      return;
    }

    await tx
      .delete(contactEntradas)
      .where(
        and(
          eq(contactEntradas.organizationId, organizationId),
          eq(contactEntradas.contactId, contactId),
          gt(contactEntradas.posicion, n),
        ),
      );

    const current = await tx
      .select({ posicion: contactEntradas.posicion })
      .from(contactEntradas)
      .where(
        and(
          eq(contactEntradas.organizationId, organizationId),
          eq(contactEntradas.contactId, contactId),
        ),
      );
    const existing = new Set(current.map((entry) => entry.posicion));
    const missing = Array.from({ length: n }, (_, index) => index + 1).filter(
      (position) => !existing.has(position),
    );

    if (missing.length > 0) {
      await tx.insert(contactEntradas).values(
        missing.map((position) => ({
          id: crypto.randomUUID(),
          organizationId,
          contactId,
          posicion: position,
          anchoCm: null,
          linea: "estandar" as const,
        })),
      );
    }
  });
}

export async function updateEntrada(
  database: Database,
  organizationId: string,
  contactId: string,
  posicion: number,
  patch: EntradaPatch,
  by: ContactActor = AGENTE,
) {
  await requireContact(database, organizationId, contactId);
  const origen = origenOf(by);
  if (origen) {
    // El origen va ANTES que el valor (y bloquea la fila del contacto, igual que el
    // agente): si el valor falla, "vendedor" solo deja el campo fuera del agente.
    const keys = [
      ...(Object.prototype.hasOwnProperty.call(patch, "anchoCm") ? [entradaKey(posicion, "ancho")] : []),
      ...(patch.linea !== undefined ? [entradaKey(posicion, "linea")] : []),
      ...(Object.prototype.hasOwnProperty.call(patch, "tamanoManual") ? [entradaKey(posicion, "tamano")] : []),
    ];
    if (keys.length) {
      await database
        .update(contacts)
        .set({ customFields: withDetallePor(sql`${contacts.customFields}`, keys, origen) })
        .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
    }
  }
  const [entry] = await database
    .select()
    .from(contactEntradas)
    .where(
      and(
        eq(contactEntradas.organizationId, organizationId),
        eq(contactEntradas.contactId, contactId),
        eq(contactEntradas.posicion, posicion),
      ),
    )
    .limit(1);

  if (!entry) {
    throw new Error("La entrada indicada no existe para este contacto.");
  }

  const anchoCm = Object.prototype.hasOwnProperty.call(patch, "anchoCm")
    ? patch.anchoCm ?? null
    : entry.anchoCm;
  const linea = patch.linea ?? entry.linea;
  const ranges = await listSizeRanges(database, organizationId);
  const values: Partial<typeof contactEntradas.$inferInsert> = {
    anchoCm,
    linea,
    tamanoSugerido: suggestSize(anchoCm, linea, ranges),
    updatedAt: new Date(),
  };

  if (Object.prototype.hasOwnProperty.call(patch, "tamanoManual")) {
    values.tamanoManual = patch.tamanoManual?.trim() || null;
  }

  const updated = await database.transaction(async (tx) => {
    const [row] = await tx
      .update(contactEntradas)
      .set(values)
      .where(
        and(
          eq(contactEntradas.organizationId, organizationId),
          eq(contactEntradas.contactId, contactId),
          eq(contactEntradas.posicion, posicion),
        ),
      )
      .returning();
    if (row) await notifyContactUpdated(tx, { organizationId, contactId, changes: ["detalle"], by });
    return row;
  });

  if (!updated) {
    throw new Error("La entrada indicada no existe para este contacto.");
  }

  return {
    id: updated.id,
    posicion: updated.posicion,
    anchoCm: updated.anchoCm,
    linea: updated.linea,
    tamanoSugerido: updated.tamanoSugerido,
    tamanoManual: updated.tamanoManual,
  };
}

export async function listSizeRanges(
  database: Database,
  organizationId: string,
): Promise<SizeRange[]> {
  return database
    .select({
      linea: tallasCompuerta.linea,
      talla: tallasCompuerta.talla,
      minCm: tallasCompuerta.minCm,
      maxCm: tallasCompuerta.maxCm,
      posicion: tallasCompuerta.posicion,
    })
    .from(tallasCompuerta)
    .where(eq(tallasCompuerta.organizationId, organizationId))
    .orderBy(asc(tallasCompuerta.linea), asc(tallasCompuerta.posicion));
}

export async function replaceSizeRanges(
  database: Database,
  organizationId: string,
  ranges: readonly SizeRange[],
): Promise<SizeRange[]> {
  const errors = validateSizeRanges(ranges);
  if (errors.length > 0) {
    throw new Error(`Los rangos de tallas no son válidos: ${errors.join(" ")}`);
  }

  const cleaned = ranges.map((range) => ({ ...range, talla: range.talla.trim() }));

  await database.transaction(async (tx) => {
    await tx
      .delete(tallasCompuerta)
      .where(eq(tallasCompuerta.organizationId, organizationId));

    if (cleaned.length > 0) {
      await tx.insert(tallasCompuerta).values(
        cleaned.map((range) => ({
          id: crypto.randomUUID(),
          organizationId,
          ...range,
        })),
      );
    }

    const entries = await tx
      .select({
        id: contactEntradas.id,
        anchoCm: contactEntradas.anchoCm,
        linea: contactEntradas.linea,
      })
      .from(contactEntradas)
      .where(eq(contactEntradas.organizationId, organizationId));

    for (const entry of entries) {
      await tx
        .update(contactEntradas)
        .set({
          tamanoSugerido: suggestSize(entry.anchoCm, entry.linea, cleaned),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(contactEntradas.id, entry.id),
            eq(contactEntradas.organizationId, organizationId),
          ),
        );
    }
  });

  return listSizeRanges(database, organizationId);
}

export async function addComment(
  database: Database,
  organizationId: string,
  contactId: string,
  authorUserId: string,
  body: string,
) {
  await requireContact(database, organizationId, contactId);
  // El Agente IA firma con su usuario de SISTEMA (no es miembro de ninguna organización).
  const [author] =
    authorUserId === AGENT_AI_USER_ID
      ? await database.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, AGENT_AI_USER_ID)).limit(1)
      : await database
          .select({ id: user.id, name: user.name })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(
            and(eq(member.organizationId, organizationId), eq(member.userId, authorUserId)),
          )
          .limit(1);
  if (!author) {
    throw new Error("El autor no pertenece a esta organización.");
  }

  const cleaned = cleanCommentBody(body);
  const created = await database.transaction(async (tx) => {
    const [row] = await tx
      .insert(contactComentarios)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        contactId,
        authorUserId,
        body: cleaned,
      })
      .returning();
    // El comentario del Agente IA (usuario de sistema) avisa como del agente, no de un vendedor.
    const by: ContactActor = authorUserId === AGENT_AI_USER_ID ? AGENTE : { kind: "vendedor", userId: authorUserId };
    await notifyContactUpdated(tx, { organizationId, contactId, changes: ["comentarios"], by });
    return row;
  });

  return {
    id: created.id,
    body: created.body,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
    author,
  };
}

export async function updateComment(
  database: Database,
  organizationId: string,
  commentId: string,
  actor: CommentActor,
  body: string,
) {
  const [comment] = await database
    .select()
    .from(contactComentarios)
    .where(
      and(
        eq(contactComentarios.id, commentId),
        eq(contactComentarios.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!comment) throw new Error("Comentario no encontrado en esta organización.");
  if (!canModifyComment(actor, comment.authorUserId)) {
    throw new Error("No puedes modificar este comentario.");
  }

  const cleaned = cleanCommentBody(body);
  return database.transaction(async (tx) => {
    const [updated] = await tx
      .update(contactComentarios)
      .set({ body: cleaned, updatedAt: new Date() })
      .where(
        and(
          eq(contactComentarios.id, commentId),
          eq(contactComentarios.organizationId, organizationId),
        ),
      )
      .returning();
    if (updated) {
      await notifyContactUpdated(tx, {
        organizationId,
        contactId: updated.contactId,
        changes: ["comentarios"],
        by: { kind: "vendedor", userId: actor.userId },
      });
    }
    return updated;
  });
}

export async function deleteComment(
  database: Database,
  organizationId: string,
  commentId: string,
  actor: CommentActor,
): Promise<void> {
  const [comment] = await database
    .select({ authorUserId: contactComentarios.authorUserId, contactId: contactComentarios.contactId })
    .from(contactComentarios)
    .where(
      and(
        eq(contactComentarios.id, commentId),
        eq(contactComentarios.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!comment) throw new Error("Comentario no encontrado en esta organización.");
  if (!canModifyComment(actor, comment.authorUserId)) {
    throw new Error("No puedes modificar este comentario.");
  }

  await database.transaction(async (tx) => {
    const deleted = await tx
      .delete(contactComentarios)
      .where(
        and(
          eq(contactComentarios.id, commentId),
          eq(contactComentarios.organizationId, organizationId),
        ),
      )
      .returning({ id: contactComentarios.id });
    if (deleted.length > 0) {
      await notifyContactUpdated(tx, {
        organizationId,
        contactId: comment.contactId,
        changes: ["comentarios"],
        by: { kind: "vendedor", userId: actor.userId },
      });
    }
  });
}
