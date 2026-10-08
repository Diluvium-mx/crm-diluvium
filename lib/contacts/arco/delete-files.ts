// Borra del bucket los archivos de un contacto ya borrado de la base (ARCO, 7-oct-2026). Corre
// DESPUÉS de confirmar la transacción: si la base se revierte, ningún archivo se pierde. Nunca se
// traga un error: devuelve qué quedó sin borrar para que la acción lo muestre y se pueda reintentar.
//
// Una entrada que termina en "/" es una CARPETA de un mensaje (lib/contacts/arco/keys.ts,
// messageFolderPrefix): se listan y se borran sus objetos (lo que se descargó sin anotarse aún).
import type { ObjectStorage } from "@/lib/storage/s3";

const PARALLEL = 8;

export type DeleteFilesResult = { deleted: number; failed: string[] };

async function deleteOne(storage: ObjectStorage, entry: string): Promise<number> {
  if (!entry.endsWith("/")) {
    await storage.deleteObject(entry);
    return 1;
  }
  if (!storage.listObjects) return 0;
  let count = 0;
  for await (const object of storage.listObjects(entry)) {
    await storage.deleteObject(object.key);
    count++;
  }
  return count;
}

/** Borra cada entrada (con un segundo intento); `failed` = las que no se pudieron, en su orden. */
export async function deleteStoredFiles(storage: ObjectStorage, entries: readonly string[]): Promise<DeleteFilesResult> {
  const unique = [...new Set(entries)];
  const failed = new Set<string>();
  let deleted = 0;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < unique.length) {
      const entry = unique[next++];
      try {
        deleted += await deleteOne(storage, entry);
      } catch {
        try {
          deleted += await deleteOne(storage, entry);
        } catch {
          failed.add(entry);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, unique.length) }, () => worker()));
  return { deleted, failed: unique.filter((e) => failed.has(e)) };
}
