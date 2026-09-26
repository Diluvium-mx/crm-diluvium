// ¿El SSE de la bandeja puede seguir abierto? La conexión vive horas (y desde los
// avisos de cambio de etapa, en todas las pantallas del CRM, con nombres de
// clientes): en cada latido se revisa que la sesión siga viva, que el usuario no
// esté desactivado y que siga siendo miembro de ESA organización. Si no, el stream
// se corta y la reconexión recibe 401 (el navegador deja de insistir).
import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { member, session, user } from "@/lib/db/schema/auth";

export async function streamStillAllowed(input: { sessionId: string; userId: string; organizationId: string }): Promise<boolean> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .innerJoin(member, and(eq(member.userId, session.userId), eq(member.organizationId, input.organizationId)))
    .where(
      and(
        eq(session.id, input.sessionId),
        eq(session.userId, input.userId),
        gt(session.expiresAt, new Date()),
        sql`coalesce(${user.banned}, false) = false`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
