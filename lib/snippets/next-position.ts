// Lugar de un mensaje rápido nuevo: al final del orden manual (26-oct-2026, `snippets.position`). Va DENTRO
// del mismo INSERT (Server Action y `npm run mensajes-rapidos:cargar`).
import { sql, type SQL } from "drizzle-orm";
import { snippets } from "@/lib/db/schema/snippets";

/** `offset` para varios en un solo INSERT: 0, 1, 2… */
export function nextSnippetPosition(organizationId: string, offset = 0): SQL<number> {
  return sql<number>`(select coalesce(max(${snippets.position}), -1) + 1 + ${offset} from ${snippets} where ${snippets.organizationId} = ${organizationId})`;
}
