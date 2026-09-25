// Miniatura de un anuncio (la ÚNICA copia chica guardada por anuncio) desde el
// bucket propio. Exige sesión, solo sirve anuncios de una organización de la
// que el usuario es miembro (CLAUDE.md §7) y redirige a una URL firmada de 5
// minutos. Nunca redirige a los links de Meta (caducan).
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, metaAds } from "@/lib/db/schema";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";

const SIGNED_URL_SECONDS = 300;

export async function GET(_req: Request, { params }: RouteContext<"/api/ads/thumbnail/[adId]">): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("no autenticado", { status: 401 });

  const { adId } = await params;
  if (!/^\d{5,25}$/.test(adId)) return new Response("no encontrado", { status: 404 });
  const [row] = await db
    .select({ key: metaAds.thumbnailKey })
    .from(metaAds)
    .innerJoin(member, and(eq(member.organizationId, metaAds.organizationId), eq(member.userId, session.user.id)))
    .where(eq(metaAds.adId, adId))
    .limit(1);
  // 404 también si existe pero es de otra organización: no se revela.
  if (!row?.key) return new Response("no encontrado", { status: 404 });

  let url: string;
  try {
    url = await objectStorage().signedGetUrl(row.key, SIGNED_URL_SECONDS);
  } catch (error) {
    if (!(error instanceof StorageNotConfiguredError)) throw error;
    return new Response("almacenamiento no configurado", { status: 503 });
  }
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=240" } });
}
