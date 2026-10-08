// Lo que lleva la exportación de UN contacto (derechos ARCO, 7-oct-2026): `datos.json` (contacto,
// Detalle, origen y sus chats con cada mensaje), `chat.txt` legible y la lista de archivos del
// cliente para `archivos/`. Siempre acotado a la organización: un contacto de otra no existe aquí.
// Lo arma la ruta GET /api/contactos/[contactId]/exportar (la descarga en zip).
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, messages } from "@/lib/db/schema";
import { getContactQualification } from "@/lib/contacts/qualification";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { formatPhone } from "@/lib/phone-format";
import { buildChatTxt } from "./chat-txt";
import { clientFiles, EXPORT_MAX_FILE_BYTES, megabytes, totalBytes, type ExportFile } from "./export-files";
import { EXPORT_TIME_ZONE, exportZipName, kindLabel, mazatlanDateTime, speakerOf, type Speaker } from "./format";

const TEMPERATURE: Record<string, string> = { caliente: "Caliente", frio: "Frío", en_espera: "En espera", destacado: "Destacado" };
const INUNDACIONES: Record<string, string> = { si: "Sí", no: "No", no_sabe: "No sabe" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram" };

export type DatosJson = {
  exportadoEl: string;
  zonaHoraria: string;
  nota: string;
  contacto: {
    nombre: string;
    apellido: string | null;
    telefono: string | null;
    correo: string | null;
    instagram: string | null;
    pais: string | null;
    origen: {
      fuente: string | null;
      canal: string | null;
      anuncio: string | null;
      otrosAnuncios: string[];
      resumenDelAnuncio: string | null;
    };
    etapa: string;
    temperatura: string | null;
    destacado: boolean;
    detalle: {
      tieneInundaciones: string | null;
      nivelAguaCm: number | null;
      nivelAguaDescripcion: string | null;
      numeroDeEntradas: number | null;
      entradas: { posicion: number; anchoCm: number | null; linea: string; tamanoSugerido: string | null; tamanoManual: string | null }[];
      montoCotizacionMxn: number | null;
      pagoTotalMxn: number | null;
      porcentajeConvencimiento: number | null;
    };
    creadoEl: string;
    enSuEtapaDesde: string;
  };
  conversaciones: {
    canal: string;
    iniciadaEl: string;
    mensajes: {
      fecha: string;
      quien: Speaker;
      tipo: string;
      texto: string | null;
      transcripcion: string | null;
      borradoPorQuienLoEnvio: boolean;
      adjuntos: { tipo: string; nombre: string | null; archivo: string | null }[];
    }[];
  }[];
  archivos: { incluidos: number; nota: string };
};

export type ContactExport = {
  zipName: string;
  datos: DatosJson;
  chatTxt: string;
  /** Archivos del cliente que van en el zip (vacío si se pidió sin archivos). */
  files: ExportFile[];
  /** Todos los archivos del cliente y su peso (para el tope). */
  clientFileCount: number;
  clientBytes: number;
  /** Con archivos pasaría el tope (EXPORT_MAX_FILE_BYTES). */
  tooBig: boolean;
};

export async function loadContactExport(
  organizationId: string,
  contactId: string,
  opts: { withFiles: boolean; now: Date },
): Promise<ContactExport | null> {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!contact) return null;

  const [detalle, stages, convs] = await Promise.all([
    getContactQualification(db, organizationId, contactId),
    listFunnelStages(organizationId),
    db
      .select({ id: conversations.id, createdAt: conversations.createdAt, channelType: channels.type })
      .from(conversations)
      .innerJoin(channels, eq(channels.id, conversations.channelId))
      .where(and(eq(conversations.organizationId, organizationId), eq(conversations.contactId, contactId)))
      .orderBy(asc(conversations.createdAt)),
  ]);
  const at = sql<Date>`coalesce(${messages.sentAt}, ${messages.createdAt})`.mapWith(messages.createdAt);
  const rows = convs.length
    ? await db
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          direction: messages.direction,
          source: messages.source,
          type: messages.type,
          body: messages.body,
          transcripcion: messages.transcripcion,
          attachments: messages.attachments,
          deletedAt: messages.deletedAt,
          at,
        })
        .from(messages)
        .where(and(eq(messages.organizationId, organizationId), inArray(messages.conversationId, convs.map((c) => c.id))))
        .orderBy(asc(at), asc(messages.id))
    : [];

  const allFiles = clientFiles(organizationId, rows);
  const clientBytes = totalBytes(allFiles);
  const tooBig = clientBytes > EXPORT_MAX_FILE_BYTES;
  const files = opts.withFiles && !tooBig ? allFiles : [];
  const filePaths = new Map(files.map((f) => [`${f.messageId}:${f.index}`, f.zipPath]));

  const fullName = [contact.firstName, contact.lastName].filter((p) => p && p.trim()).join(" ").trim() || "Sin nombre";
  const phone = contact.phoneE164 ? formatPhone(contact.phoneE164) : null;
  const instagram = contact.instagramUsername ? `@${contact.instagramUsername}` : null;
  const byConversation = convs.map((c) => ({
    conversation: c,
    channelLabel: CHANNEL[c.channelType] ?? c.channelType,
    messages: rows.filter((m) => m.conversationId === c.id),
  }));

  const datos: DatosJson = {
    exportadoEl: mazatlanDateTime(opts.now),
    zonaHoraria: EXPORT_TIME_ZONE,
    nota: "Fechas en hora de Mazatlán. En «archivos/» van los archivos que mandó el cliente; lo que mandó Diluvium solo aparece por su nombre.",
    contacto: {
      nombre: contact.firstName,
      apellido: contact.lastName,
      telefono: contact.phoneE164,
      correo: contact.email,
      instagram,
      pais: contact.country ?? contact.phoneCountryIso,
      origen: {
        fuente: contact.source,
        canal: contact.sourceChannel,
        anuncio: detalle.anuncios?.first.name ?? null,
        otrosAnuncios: detalle.anuncios?.others.map((o) => o.name) ?? [],
        resumenDelAnuncio: detalle.anuncio,
      },
      etapa: stages.find((s) => s.key === contact.stage)?.name ?? contact.stage,
      temperatura: contact.temperature ? (TEMPERATURE[contact.temperature] ?? contact.temperature) : null,
      destacado: contact.destacado,
      detalle: {
        tieneInundaciones: detalle.tieneInundaciones ? (INUNDACIONES[detalle.tieneInundaciones] ?? detalle.tieneInundaciones) : null,
        nivelAguaCm: detalle.nivelAguaCm,
        nivelAguaDescripcion: detalle.nivelAguaTexto,
        numeroDeEntradas: detalle.numEntradas,
        entradas: detalle.entradas.map((e) => ({
          posicion: e.posicion,
          anchoCm: e.anchoCm,
          linea: e.linea,
          tamanoSugerido: e.tamanoSugerido,
          tamanoManual: e.tamanoManual,
        })),
        montoCotizacionMxn: detalle.montoCotizacion,
        pagoTotalMxn: detalle.pagoTotal,
        porcentajeConvencimiento: detalle.porcentajeConvencimiento,
      },
      creadoEl: mazatlanDateTime(contact.createdAt),
      enSuEtapaDesde: mazatlanDateTime(contact.stageChangedAt),
    },
    conversaciones: byConversation.map(({ conversation, channelLabel, messages: list }) => ({
      canal: channelLabel,
      iniciadaEl: mazatlanDateTime(conversation.createdAt),
      mensajes: list
        .filter((m) => m.type !== "system_note")
        .map((m) => ({
          fecha: mazatlanDateTime(m.at),
          quien: speakerOf(m),
          tipo: kindLabel(m.type),
          texto: m.body,
          transcripcion: m.transcripcion,
          borradoPorQuienLoEnvio: m.deletedAt !== null,
          adjuntos: m.attachments.map((a, index) => ({
            tipo: kindLabel(a.type),
            nombre: a.fileName ?? null,
            archivo: filePaths.get(`${m.id}:${index}`) ?? null,
          })),
        })),
    })),
    archivos: {
      incluidos: files.length,
      nota:
        allFiles.length === 0
          ? "El cliente no mandó archivos (o ninguno se pudo guardar)."
          : files.length > 0
            ? "Los archivos del cliente van en la carpeta «archivos/»."
            : tooBig
              ? `Se exportó sin archivos: los ${allFiles.length} archivos del cliente pesan ${megabytes(clientBytes)} y el máximo es ${megabytes(EXPORT_MAX_FILE_BYTES)}.`
              : "Se exportó sin archivos (así se pidió).",
    },
  };

  const chatTxt = buildChatTxt({
    contactName: fullName,
    handle: phone ?? instagram,
    exportedAt: opts.now,
    conversations: byConversation.map(({ channelLabel, messages: list }) => ({
      channelLabel,
      messages: list.map((m) => ({ ...m, deleted: m.deletedAt !== null })),
    })),
    filePaths,
  });

  return {
    zipName: exportZipName(fullName, opts.now),
    datos,
    chatTxt,
    files,
    clientFileCount: allFiles.length,
    clientBytes,
    tooBig,
  };
}
