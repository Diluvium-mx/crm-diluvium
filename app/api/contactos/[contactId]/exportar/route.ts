// Exportar los datos de UN contacto (derechos ARCO, 7-oct-2026): descarga
// `contacto-<nombre>-<AAAA-MM-DD>.zip` con datos.json, chat.txt y archivos/ (SOLO lo que mandó el
// cliente). La pide «Exportar datos» del Detalle del contacto.
//
// Es una ruta GET y no una Server Action a propósito: es una DESCARGA de archivo (el navegador la
// guarda con Content-Disposition), puede pesar hasta 200 MB y va en streaming desde el bucket; una
// Server Action serializa su respuesta completa (Flight) en memoria, no entrega un archivo al
// navegador y bloquearía las demás acciones de la pestaña mientras dura (se despachan en fila).
//
// Igual que /api/media: exige sesión y membresía vigente; la organización sale de
// requireActiveMembership (nunca del cliente) y un contacto de otra organización da 404 (no se
// revela que existe). `?sinArchivos=1` = solo datos.json y chat.txt (cuando los archivos pasan el tope).
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { loadContactExport } from "@/lib/contacts/arco/export-data";
import { EXPORT_MAX_FILE_BYTES, megabytes, type ExportFile } from "@/lib/contacts/arco/export-files";
import { zipStream, type ZipEntry } from "@/lib/contacts/arco/zip-stream";
import { logError } from "@/lib/log/safe-error";
import { objectStorage, StorageNotConfiguredError, type ObjectStorage } from "@/lib/storage/s3";
import { z } from "zod";

export const dynamic = "force-dynamic";

const contactIdSchema = z.string().trim().min(1).max(128);

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });

async function* entries(
  data: { datosJson: string; chatTxt: string; files: readonly ExportFile[]; now: Date },
  storage: ObjectStorage | null,
): AsyncGenerator<ZipEntry> {
  const encoder = new TextEncoder();
  yield { name: "datos.json", data: encoder.encode(data.datosJson), mtime: data.now };
  yield { name: "chat.txt", data: encoder.encode(data.chatTxt), mtime: data.now };
  const missing: string[] = [];
  for (const file of data.files) {
    try {
      if (!storage?.getStream) throw new Error("bucket sin lectura en streaming");
      const { body } = await storage.getStream(file.key);
      yield { name: file.zipPath, body, mtime: data.now };
    } catch (error) {
      logError("[exportar contacto] no se pudo leer un archivo del bucket", error);
      missing.push(file.zipPath);
    }
  }
  if (missing.length > 0) {
    const note = [
      "Estos archivos del cliente no se pudieron leer del almacenamiento y NO van en este zip.",
      "Vuelve a exportar en unos minutos; si siguen faltando, avísale a Code.",
      "",
      ...missing,
    ].join("\n");
    yield { name: "archivos/NO-INCLUIDOS.txt", data: encoder.encode(`${note}\n`), mtime: data.now };
  }
}

export async function GET(req: Request, { params }: RouteContext<"/api/contactos/[contactId]/exportar">): Promise<Response> {
  let membership;
  try {
    membership = await requireActiveMembership();
  } catch {
    return text("no autenticado", 401);
  }
  if (!roleAllows(membership.role, "contact", "export")) return text("sin permiso para exportar contactos", 403);

  const parsed = contactIdSchema.safeParse((await params).contactId);
  if (!parsed.success) return text("no encontrado", 404);
  const withFiles = new URL(req.url).searchParams.get("sinArchivos") !== "1";

  const now = new Date();
  const data = await loadContactExport(membership.organizationId, parsed.data, { withFiles, now });
  if (!data) return text("no encontrado", 404);
  if (withFiles && data.tooBig) {
    return text(
      `Los archivos que mandó el cliente pesan ${megabytes(data.clientBytes)} y el máximo es ${megabytes(EXPORT_MAX_FILE_BYTES)}. Descarga sin archivos.`,
      413,
    );
  }

  let storage: ObjectStorage | null = null;
  if (data.files.length > 0) {
    try {
      storage = objectStorage();
    } catch (error) {
      if (!(error instanceof StorageNotConfiguredError)) throw error;
      logError("[exportar contacto] bucket no configurado", error);
      return text("almacenamiento no configurado", 503);
    }
  }

  const stream = zipStream(
    entries({ datosJson: `${JSON.stringify(data.datos, null, 2)}\n`, chatTxt: data.chatTxt, files: data.files, now }, storage),
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      // El nombre ya es ASCII (exportZipName); filename* por si acaso.
      "Content-Disposition": `attachment; filename="${data.zipName}"; filename*=UTF-8''${encodeURIComponent(data.zipName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
