// Lecturas y escrituras de los links de pago (Agente IA › Links de pago, 30-oct-2026; reglas en
// ./links-pago.ts). Sin sesión: la Server Action (lib/actions/links-pago.ts) resuelve la organización
// y el permiso. Toda consulta filtra por organization_id. Sin "server-only": también lo usa el worker
// (herramienta del Agente IA, lib/ai/runtime/actions.ts).
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { linksPago, linksPagoTextos, messages } from "@/lib/db/schema";
import { logChanges } from "@/lib/historial/log";
import { linksPagoSchema, mensajesLink, TEXTOS_DE_FABRICA, textosLinkSchema, type LinkPago, type LinkPagoInput, type TextosLink } from "./links-pago";

type Row = typeof linksPago.$inferSelect;

const toLink = (r: Row): LinkPago => ({ id: r.id, nombre: r.nombre, monto: Number(r.monto), cubre: r.cubre, meses: r.meses, url: r.url, soloVendedor: r.soloVendedor, posicion: r.posicion });

export async function listLinksPago(organizationId: string): Promise<LinkPago[]> {
  const rows = await db.select().from(linksPago).where(eq(linksPago.organizationId, organizationId)).orderBy(asc(linksPago.posicion), asc(linksPago.createdAt));
  return rows.map(toLink);
}

/** Los dos mensajes de la organización (sin fila o en null, los de fábrica). */
export async function loadTextosLink(organizationId: string): Promise<TextosLink> {
  const [row] = await db.select().from(linksPagoTextos).where(eq(linksPagoTextos.organizationId, organizationId)).limit(1);
  return { mensaje1: row?.mensaje1 ?? TEXTOS_DE_FABRICA.mensaje1, mensaje2: row?.mensaje2 ?? TEXTOS_DE_FABRICA.mensaje2 };
}

// Resumen para el Historial: una línea por link («1 compuerta estándar $5,500 · 6 MSI · link») y los textos.
function resumen(links: readonly Pick<LinkPago, "nombre" | "monto" | "meses" | "url" | "soloVendedor">[], textos: TextosLink): string {
  const lista = links.length
    ? links.map((l) => `${l.nombre} $${l.monto.toLocaleString("es-MX", { maximumFractionDigits: 2 })} · ${l.meses > 0 ? `${l.meses} MSI` : "contado"}${l.soloVendedor ? " · solo vendedor" : ""} · ${l.url}`).join("\n")
    : "Sin links";
  return `${lista}\nMensaje 1: ${textos.mensaje1}\nMensaje 2: ${textos.mensaje2 || "(no sale)"}`;
}

/**
 * Reemplaza la lista completa (en el orden recibido) y, si vienen, los dos mensajes. Guardar lo mismo no
 * deja fila en el Historial.
 */
export async function replaceLinksPago(
  organizationId: string,
  input: readonly LinkPagoInput[] | unknown,
  userId: string | null,
  textosInput?: TextosLink | unknown,
): Promise<LinkPago[]> {
  const links = linksPagoSchema.parse(input);
  const textos = textosInput === undefined ? null : textosLinkSchema.parse(textosInput);
  const textosAntes = await loadTextosLink(organizationId);
  await db.transaction(async (tx) => {
    const previous = (await tx.select().from(linksPago).where(eq(linksPago.organizationId, organizationId)).orderBy(asc(linksPago.posicion), asc(linksPago.createdAt))).map(toLink);
    await tx.delete(linksPago).where(eq(linksPago.organizationId, organizationId));
    if (links.length > 0) {
      await tx.insert(linksPago).values(
        links.map((l, i) => ({
          id: crypto.randomUUID(),
          organizationId,
          nombre: l.nombre,
          monto: l.monto.toFixed(2),
          cubre: l.cubre,
          meses: l.meses,
          url: l.url,
          soloVendedor: l.soloVendedor,
          posicion: i + 1,
        })),
      );
    }
    if (textos) {
      await tx
        .insert(linksPagoTextos)
        .values({ organizationId, mensaje1: textos.mensaje1, mensaje2: textos.mensaje2, updatedAt: new Date() })
        .onConflictDoUpdate({ target: linksPagoTextos.organizationId, set: { mensaje1: textos.mensaje1, mensaje2: textos.mensaje2, updatedAt: new Date() } });
    }
    const before = resumen(previous, textosAntes);
    const after = resumen(links, textos ?? textosAntes);
    if (before !== after) {
      await logChanges(tx, { organizationId, userId, kind: "links_pago", action: "editar", oldValue: before, newValue: after });
    }
  });
  return listLinksPago(organizationId);
}

/**
 * ¿El texto es, tal cual, uno de los mensajes de un link de la organización? Lo usa el último candado
 * del Agente IA (sendAgentText): el mensaje de los datos de envío trae renglones de una palabra
 * («Dirección», «Teléfono») que el candado toma por notas internas del modelo; estos textos los escribió
 * el dueño, así que pasan. Solo se consulta cuando el candado ya marcó algo.
 */
export async function esMensajeDeLink(organizationId: string, text: string): Promise<boolean> {
  const t = text.trim();
  const [links, textos] = await Promise.all([listLinksPago(organizationId), loadTextosLink(organizationId)]);
  return links.some((l) => mensajesLink(l, textos).includes(t));
}

/** Links que el Agente IA ya mandó en este chat (cualquiera de la lista vigente). */
export async function linksSentByAgent(organizationId: string, conversationId: string, urls: readonly string[]): Promise<number> {
  const list = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (list.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        eq(messages.source, "ai_agent"),
        sql`(${sql.join(
          list.map((u) => sql`strpos(coalesce(${messages.body}, ''), ${u}) > 0`),
          sql` or `,
        )})`,
      ),
    );
  return row?.n ?? 0;
}
