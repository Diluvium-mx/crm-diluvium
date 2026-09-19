// Uso: npx tsx scripts/seed-inbox.ts
// Siembra ~10 conversaciones falsas de la bandeja (Fase 2) para VER la UI en
// local sin datos reales de WhatsApp. Respeta el shape de las tablas de
// mensajería (lib/db/schema/messaging.ts) y cómo lib/inbox/queries.ts deriva
// ventana/semáforo/no-leídos/canRetry/estado de adjuntos. NO toca lib/ de
// negocio: solo escribe filas con el mismo `db` de Drizzle que usan las
// Server Actions (patrón de scripts/seed-contactos.ts).
//
// Idempotente: antes de sembrar borra su propio canal ("seed-inbox-account",
// que en cascada se lleva conversaciones y mensajes) y sus contactos
// (source = "seed-inbox"). Se puede correr varias veces sin romper.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { member, organization } from "@/lib/db/schema/auth";
import { contacts } from "@/lib/db/schema/contacts";
import { channels, conversations, messages } from "@/lib/db/schema/messaging";
import type { MessageAttachment } from "@/lib/db/schema/messaging";

const SEED_SOURCE = "seed-inbox";
const SEED_PROVIDER_ACCOUNT = "seed-inbox-account";

const now = Date.now();
const min = (n: number) => new Date(now - n * 60_000);
const hrs = (n: number) => new Date(now - n * 3_600_000);
const days = (n: number) => new Date(now - n * 86_400_000);
const inHrs = (n: number) => new Date(now + n * 3_600_000);
const id = () => crypto.randomUUID();

type Dir = "in" | "out";
type Src = "contact" | "crm" | "business_app" | "other_api";
type MType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "template" | "interactive" | "unknown";
type MStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "received";

type MsgSpec = {
  dir: Dir;
  type?: MType;
  body?: string | null;
  at: Date;
  status?: MStatus;
  source?: Src;
  attachments?: MessageAttachment[];
  errorCode?: string;
  errorMessage?: string;
  adReferral?: Record<string, unknown>;
  fromUser?: boolean; // saliente humano (cuenta como "respuesta enviada")
};

type ConvSpec = {
  firstName: string;
  lastName: string | null;
  phone: string;
  sourceChannel: string; // badge del avatar
  stage: "inbox" | "prospecto" | "interesado" | "cerca_compra" | "compra";
  temperature: "caliente" | "frio" | "en_espera" | "destacado" | null;
  unread: number;
  starred?: boolean;
  windowExpiresAt: Date | null;
  adReferral?: Record<string, unknown>;
  msgs: MsgSpec[];
};

const AD = {
  headline: "Compuertas antiinundación Diluvium",
  body: "Protege tu propiedad esta temporada de lluvias. Cotiza sin costo.",
  thumbnail_url: "https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=200",
  source_url: "https://diluvium.com.mx",
  media_type: "image",
};

// Adjuntos de ejemplo (sin storageKey → la UI muestra "procesando…"; con
// downloadAttempts alto → "no disponible"). URL de proveedor placeholder.
const attProcessing: MessageAttachment[] = [
  { type: "image", url: "https://provider.example/media/abc", mimeType: "image/jpeg", downloadAttempts: 0 },
];
const attFailed: MessageAttachment[] = [
  { type: "document", url: "https://provider.example/media/xyz", mimeType: "application/pdf", fileName: "cotizacion.pdf", downloadAttempts: 25 },
];

const CONVS: ConvSpec[] = [
  {
    firstName: "Guadalupe", lastName: "Díaz", phone: "+525512340001", sourceChannel: "whatsapp",
    stage: "prospecto", temperature: "caliente", unread: 3, starred: true, windowExpiresAt: inHrs(20),
    msgs: [
      { dir: "in", body: "Hola, vi su anuncio de las compuertas.", at: days(1) },
      { dir: "out", body: "¡Hola Guadalupe! Claro, con gusto le cotizo. ¿Para qué zona?", at: days(1), fromUser: true },
      { dir: "in", body: "Para Los Mochis, una bodega.", at: min(45) },
      { dir: "in", body: "¿Siguen disponibles?", at: min(5) },
    ],
  },
  {
    firstName: "José", lastName: "Flores", phone: "+525512340002", sourceChannel: "whatsapp",
    stage: "interesado", temperature: "frio", unread: 0, windowExpiresAt: inHrs(10),
    msgs: [
      { dir: "out", body: "Buen día José, le comparto el catálogo.", at: hrs(3), fromUser: true },
      { dir: "in", body: "Gracias, lo reviso.", at: min(30) },
    ],
  },
  {
    firstName: "Juan", lastName: "Pérez", phone: "+525512340003", sourceChannel: "whatsapp",
    stage: "inbox", temperature: "en_espera", unread: 1, windowExpiresAt: inHrs(22),
    msgs: [
      { dir: "in", body: "¿Hacen envíos a Culiacán?", at: hrs(2) },
    ],
  },
  {
    firstName: "Roger", lastName: "López", phone: "+525512340004", sourceChannel: "whatsapp",
    stage: "cerca_compra", temperature: "destacado", unread: 0, starred: true, windowExpiresAt: inHrs(18),
    msgs: [
      { dir: "in", body: "Quiero avanzar con el pedido.", at: hrs(2) },
      { dir: "out", body: "Excelente Roger, le preparo la orden.", at: hrs(1), fromUser: true },
      { dir: "out", body: "¿Confirmamos la dirección de entrega?", at: min(40), status: "failed", errorCode: "131047", errorMessage: "WhatsApp rechazó el mensaje. Puedes reintentarlo.", fromUser: true },
    ],
  },
  {
    firstName: "Laura", lastName: "Rosa", phone: "+525512340005", sourceChannel: "whatsapp",
    stage: "compra", temperature: "caliente", unread: 0, windowExpiresAt: inHrs(12), adReferral: AD,
    msgs: [
      { dir: "in", body: "Hola, me interesa lo del anuncio.", at: hrs(3), adReferral: AD },
      { dir: "out", body: "¡Bienvenida Laura! Con gusto le explico.", at: hrs(2), fromUser: true },
    ],
  },
  {
    firstName: "Ana", lastName: "Díaz", phone: "+525512340006", sourceChannel: "whatsapp",
    stage: "prospecto", temperature: "en_espera", unread: 2, windowExpiresAt: inHrs(21),
    msgs: [
      { dir: "in", type: "image", body: null, at: min(30), attachments: attProcessing },
      { dir: "in", body: "Le mando la foto del área.", at: min(29) },
    ],
  },
  {
    firstName: "Miguel", lastName: "Ramírez", phone: "+525512340007", sourceChannel: "whatsapp",
    stage: "interesado", temperature: "frio", unread: 0, windowExpiresAt: inHrs(8),
    msgs: [
      { dir: "in", type: "document", body: null, at: hrs(4), attachments: attFailed },
      { dir: "out", body: "Recibido, reviso el documento y le confirmo.", at: hrs(3), fromUser: true },
    ],
  },
  {
    firstName: "Daniela", lastName: "Reyes", phone: "+525512340008", sourceChannel: "whatsapp",
    stage: "cerca_compra", temperature: "destacado", unread: 0, starred: true, windowExpiresAt: hrs(2),
    msgs: [
      { dir: "in", body: "¿Me pueden llamar mañana?", at: hrs(26) },
    ],
  },
  {
    firstName: "Sofía", lastName: "Sánchez", phone: "+525512340009", sourceChannel: "whatsapp",
    stage: "prospecto", temperature: "caliente", unread: 5, windowExpiresAt: inHrs(23),
    msgs: [
      { dir: "in", body: "Buenas, ¿tienen medidas especiales?", at: days(2) },
      { dir: "out", body: "Sí Sofía, las fabricamos a medida.", at: days(2), fromUser: true },
      { dir: "in", body: "Perfecto. ¿Precio del metro lineal?", at: days(1) },
      { dir: "out", body: "Le paso la lista por aquí.", at: days(1), fromUser: true },
      { dir: "in", body: "Gracias.", at: hrs(5) },
      { dir: "in", body: "Una duda más…", at: min(8) },
    ],
  },
  {
    firstName: "Carlos", lastName: "Gómez", phone: "+525512340010", sourceChannel: "fb",
    stage: "inbox", temperature: null, unread: 0, windowExpiresAt: inHrs(15),
    msgs: [
      { dir: "in", body: "Hola, escribo por Messenger.", at: hrs(6) },
      { dir: "out", body: "¡Hola Carlos! ¿En qué le ayudo?", at: hrs(5), fromUser: true },
    ],
  },
];

async function main() {
  const slug = process.env.SEED_ORG_SLUG ?? "diluvium";
  const [org] =
    (await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug))) ??
    [];
  const orgRow = org ?? (await db.select({ id: organization.id }).from(organization).limit(1))[0];
  if (!orgRow) {
    throw new Error("No hay organización. Corre scripts/seed-user.ts y scripts/seed-org.ts primero.");
  }
  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgRow.id), eq(member.role, "owner")))
    .limit(1);
  const ownerId = owner?.userId ?? null;

  // Idempotencia: borra el canal seed (cascada → conversaciones y mensajes) y
  // los contactos seed antes de re-sembrar.
  await db.delete(channels).where(and(eq(channels.organizationId, orgRow.id), eq(channels.providerAccountId, SEED_PROVIDER_ACCOUNT)));
  await db.delete(contacts).where(and(eq(contacts.organizationId, orgRow.id), eq(contacts.source, SEED_SOURCE)));

  const channelId = id();
  await db.insert(channels).values({
    id: channelId,
    organizationId: orgRow.id,
    type: "whatsapp",
    provider: "zernio",
    providerAccountId: SEED_PROVIDER_ACCOUNT,
    displayName: "Diluvium (demo)",
    phoneE164: "+525500000000",
    isActive: true,
  });

  let convCount = 0;
  let msgCount = 0;
  for (const spec of CONVS) {
    const contactId = id();
    await db.insert(contacts).values({
      id: contactId,
      organizationId: orgRow.id,
      firstName: spec.firstName,
      lastName: spec.lastName,
      phoneE164: spec.phone,
      source: SEED_SOURCE,
      sourceChannel: spec.sourceChannel,
      stage: spec.stage,
      temperature: spec.temperature,
    });

    const conversationId = id();
    const lastAt = spec.msgs.reduce((max, m) => (m.at > max ? m.at : max), spec.msgs[0].at);
    await db.insert(conversations).values({
      id: conversationId,
      organizationId: orgRow.id,
      contactId,
      channelId,
      status: "open",
      unreadCount: spec.unread,
      isStarred: spec.starred ?? false,
      windowExpiresAt: spec.windowExpiresAt,
      adReferral: spec.adReferral ?? null,
      lastMessageAt: lastAt,
    });

    for (const m of spec.msgs) {
      const isOut = m.dir === "out";
      await db.insert(messages).values({
        id: id(),
        organizationId: orgRow.id,
        conversationId,
        direction: m.dir,
        source: m.source ?? (isOut ? "crm" : "contact"),
        type: m.type ?? "text",
        body: m.body ?? null,
        attachments: m.attachments ?? [],
        status: m.status ?? (isOut ? "delivered" : "received"),
        errorCode: m.errorCode ?? null,
        errorMessage: m.errorMessage ?? null,
        // Un saliente humano necesita sentByUserId (para el semáforo/primera
        // respuesta). Un fallido sigue siendo humano pero no "enviado".
        sentByUserId: isOut && m.fromUser ? ownerId : null,
        // providerMessageId null en el fallido → canRetry (junto con crm/text).
        providerMessageId: null,
        adReferral: m.adReferral ?? null,
        sentAt: m.at,
      });
      msgCount++;
    }
    convCount++;
  }

  console.log(`Bandeja sembrada en org ${orgRow.id}: ${convCount} conversaciones, ${msgCount} mensajes.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
