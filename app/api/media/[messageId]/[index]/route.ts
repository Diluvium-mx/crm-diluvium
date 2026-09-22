// Ver/descargar un adjunto de un mensaje (lo usará la bandeja del track UI:
// <img src="/api/media/{messageId}/{index}">).
//
// El bucket es privado: esta ruta exige sesión, verifica que el usuario sea
// miembro de la organización DUEÑA del mensaje (CLAUDE.md §7) y redirige a una
// URL firmada que caduca en 5 minutos. Si el archivo aún no se descarga al
// bucket, responde 202 para que la UI muestre "procesando".
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, messages } from "@/lib/db/schema";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";

const SIGNED_URL_SECONDS = 300;

export async function GET(req: Request, { params }: RouteContext<"/api/media/[messageId]/[index]">): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("no autenticado", { status: 401 });

  const { messageId, index: rawIndex } = await params;
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) return new Response("índice inválido", { status: 400 });

  const [row] = await db
    .select({ organizationId: messages.organizationId, attachments: messages.attachments })
    .from(messages)
    .innerJoin(
      member,
      and(eq(member.organizationId, messages.organizationId), eq(member.userId, session.user.id)),
    )
    .where(eq(messages.id, messageId))
    .limit(1);
  // 404 también si existe pero es de otra organización: no se revela.
  if (!row) return new Response("no encontrado", { status: 404 });

  const attachment = row.attachments[index];
  if (!attachment) return new Response("no encontrado", { status: 404 });
  if (!attachment.storageKey) {
    return Response.json(
      { status: "pending", error: attachment.downloadError ?? null },
      { status: 202, headers: { "Retry-After": "5" } },
    );
  }

  // ?thumb=1 → miniatura de la 1ª página (PDF); ?download=1 → forzar descarga.
  const search = new URL(req.url).searchParams;
  const wantsThumb = search.get("thumb") === "1";
  if (wantsThumb && !attachment.thumbnailKey) return new Response("sin miniatura", { status: 404 });
  const key = wantsThumb && attachment.thumbnailKey ? attachment.thumbnailKey : attachment.storageKey;
  const disposition = search.get("download") === "1" ? "attachment" : "inline";

  let url: string;
  try {
    // Para forzar la descarga hace falta un nombre (una foto no trae fileName).
    const name = wantsThumb ? undefined : (attachment.fileName ?? (disposition === "attachment" ? `adjunto-${index + 1}` : undefined));
    url = await objectStorage().signedGetUrl(key, SIGNED_URL_SECONDS, name, disposition);
  } catch (error) {
    if (!(error instanceof StorageNotConfiguredError)) throw error;
    console.error("[media] bucket no configurado:", error.message);
    return new Response("almacenamiento no configurado", { status: 503 });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "private, no-store" },
  });
}
