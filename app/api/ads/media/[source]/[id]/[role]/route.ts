// Media de un anuncio (imagen, video o miniatura) desde el bucket propio.
// source = "click" (ficha del webhook, por id del clic) o "ad" (creativo de la
// API de Marketing, por id del anuncio). Exige sesión, solo sirve archivos de
// una organización de la que el usuario es miembro (CLAUDE.md §7) y redirige a
// una URL firmada de 5 minutos. Nunca redirige a los links de Meta (caducan).
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { adClicks, member, metaAds, type AdMediaItem } from "@/lib/db/schema";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";

const SIGNED_URL_SECONDS = 300;
const ROLES = new Set<AdMediaItem["role"]>(["image", "video", "thumbnail"]);

export async function GET(_req: Request, { params }: RouteContext<"/api/ads/media/[source]/[id]/[role]">): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("no autenticado", { status: 401 });

  const { source, id, role } = await params;
  if (!ROLES.has(role as AdMediaItem["role"])) return new Response("no encontrado", { status: 404 });

  let media: AdMediaItem[] | undefined;
  if (source === "click") {
    const [row] = await db
      .select({ media: adClicks.media })
      .from(adClicks)
      .innerJoin(member, and(eq(member.organizationId, adClicks.organizationId), eq(member.userId, session.user.id)))
      .where(eq(adClicks.id, id))
      .limit(1);
    media = row?.media;
  } else if (source === "ad") {
    const [row] = await db
      .select({ media: metaAds.creativeMedia })
      .from(metaAds)
      .innerJoin(member, and(eq(member.organizationId, metaAds.organizationId), eq(member.userId, session.user.id)))
      .where(eq(metaAds.adId, id))
      .limit(1);
    media = row?.media;
  }
  // 404 también si existe pero es de otra organización: no se revela.
  const item = media?.find((m) => m.role === role && m.storageKey);
  if (!item?.storageKey) return new Response("no encontrado", { status: 404 });

  let url: string;
  try {
    url = await objectStorage().signedGetUrl(item.storageKey, SIGNED_URL_SECONDS);
  } catch (error) {
    if (!(error instanceof StorageNotConfiguredError)) throw error;
    return new Response("almacenamiento no configurado", { status: 503 });
  }
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=240" } });
}
