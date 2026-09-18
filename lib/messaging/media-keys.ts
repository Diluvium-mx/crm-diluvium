// Funciones puras de la descarga de media (sin base de datos), para testear solas.
import { createHash } from "node:crypto";
import type { MessageAttachment } from "@/lib/db/schema";

export function storageKeyFor(orgId: string, messageId: string, index: number, attachment: MessageAttachment): string {
  const base = (attachment.fileName ?? attachment.providerMediaId ?? attachment.type)
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return `org/${orgId}/messages/${messageId}/${index}-${base || "archivo"}`;
}

export function sha256Base64(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("base64");
}
