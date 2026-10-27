// La guía LISTA PARA IMPRIMIR de un envío (docs/envios.md › Impresión): solo las páginas de su paquetería,
// en hoja carta y a tamaño real. La abre «Imprimir guía» del Detalle en otra pestaña.
//
// Ruta GET y no Server Action: es un ARCHIVO que el navegador muestra (inline) e imprime. Igual que
// /api/contactos/[contactId]/exportar: exige sesión y membresía; una guía de otra organización da 404.
// Si al generar no se pudo guardar el PDF en el bucket, aquí se arma desde la liga de Envia y se guarda.
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { enviaClient } from "@/lib/envia/client";
import { enviaConfigFrom } from "@/lib/envia/config";
import { storeLabelFiles } from "@/lib/envios/service";
import { getShipment } from "@/lib/envios/store";
import { safeFileName } from "@/lib/chat-attachments/keys";
import { logError } from "@/lib/log/safe-error";
import { LABEL_MAX_BYTES } from "@/lib/envia/client";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";
import { z } from "zod";

export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(1).max(64);

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });

export async function GET(_req: Request, { params }: RouteContext<"/api/envios/[shipmentId]/guia">): Promise<Response> {
  let membership;
  try {
    membership = await requireActiveMembership();
  } catch {
    return text("no autenticado", 401);
  }
  if (!roleAllows(membership.role, "contact", "read")) return text("sin permiso", 403);
  const parsed = idSchema.safeParse((await params).shipmentId);
  if (!parsed.success) return text("no encontrado", 404);
  const shipment = await getShipment(membership.organizationId, parsed.data);
  if (!shipment || !shipment.labelUrl || (shipment.status !== "creada" && shipment.status !== "cancelada")) return text("no encontrado", 404);

  let pdf: Uint8Array;
  try {
    if (shipment.printKey) {
      pdf = await objectStorage().getBytes(shipment.printKey, LABEL_MAX_BYTES);
    } else {
      const config = enviaConfigFrom(process.env);
      if (!config) return text("Envia no está configurado en este servidor", 503);
      pdf = await storeLabelFiles(
        { env: config.env, client: enviaClient(config), storage: objectStorage },
        membership.organizationId,
        shipment.id,
        shipment.carrier,
        shipment.labelUrl,
      );
    }
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) return text("almacenamiento no configurado", 503);
    logError("[envios] no se pudo servir la guía para imprimir", error);
    return text("No se pudo abrir la guía. Intenta de nuevo en un momento.", 502);
  }

  const name = safeFileName(`guia-${shipment.carrier}-${(shipment.trackingNumber ?? shipment.id).split(",")[0]}.pdf`);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
