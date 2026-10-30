// Lecturas y escrituras de los links de pago (Agente IA › Links de pago, 30-oct-2026; reglas en
// ./links-pago.ts). Sin sesión: la Server Action (lib/actions/links-pago.ts) resuelve la organización
// y el permiso. Toda consulta filtra por organization_id. Sin "server-only": también lo usa el worker
// (herramienta del Agente IA, lib/ai/runtime/actions.ts).
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { linksPago, messages } from "@/lib/db/schema";
import { logChanges } from "@/lib/historial/log";
import { linksPagoSchema, type LinkPago, type LinkPagoInput } from "./links-pago";

type Row = typeof linksPago.$inferSelect;

const toLink = (r: Row): LinkPago => ({ id: r.id, nombre: r.nombre, monto: Number(r.monto), cubre: r.cubre, meses: r.meses, url: r.url, posicion: r.posicion });

export async function listLinksPago(organizationId: string): Promise<LinkPago[]> {
  const rows = await db.select().from(linksPago).where(eq(linksPago.organizationId, organizationId)).orderBy(asc(linksPago.posicion), asc(linksPago.createdAt));
  return rows.map(toLink);
}

// Resumen de una línea por link para el Historial («1 compuerta estándar $5,500 · 6 MSI»).
function resumen(links: readonly Pick<LinkPago, "nombre" | "monto" | "meses" | "url">[]): string {
  if (links.length === 0) return "Sin links";
  return links.map((l) => `${l.nombre} $${l.monto.toLocaleString("es-MX", { maximumFractionDigits: 2 })} · ${l.meses > 0 ? `${l.meses} MSI` : "contado"} · ${l.url}`).join("\n");
}

/** Reemplaza la lista completa (en el orden recibido). Guardar lo mismo no deja fila en el Historial. */
export async function replaceLinksPago(organizationId: string, input: readonly LinkPagoInput[] | unknown, userId: string | null): Promise<LinkPago[]> {
  const links = linksPagoSchema.parse(input);
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
          posicion: i + 1,
        })),
      );
    }
    const before = resumen(previous);
    const after = resumen(links);
    if (before !== after) {
      await logChanges(tx, { organizationId, userId, kind: "links_pago", action: "editar", oldValue: before, newValue: after });
    }
  });
  return listLinksPago(organizationId);
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
