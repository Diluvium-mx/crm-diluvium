// Almacenamiento de archivos del CRM: Railway Storage Bucket (compatible con
// S3, privado). Sin terceros: el bucket es de Railway, igual que la base.
// Variables (referencias al bucket en Railway): S3_BUCKET, S3_ENDPOINT,
// S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ObjectStorage {
  /**
   * Sube en streaming (por partes de 5 MB): la memoria no depende del tamaño
   * del archivo. Si el stream termina con error, la subida se aborta y el
   * objeto NO queda creado.
   */
  putStream(key: string, body: Readable, contentType: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Tamaño y tipo del objeto, o null si no existe. */
  head(key: string): Promise<{ bytes: number; contentType: string | null } | null>;
  /** Borra el objeto (idempotente: si no existe, no falla). */
  deleteObject(key: string): Promise<void>;
  /**
   * URL firmada y temporal de un objeto privado. `disposition`: "inline" para
   * verlo en el navegador (visor), "attachment" para forzar la descarga.
   */
  signedGetUrl(
    key: string,
    expiresInSeconds: number,
    downloadName?: string,
    disposition?: "inline" | "attachment",
  ): Promise<string>;
  /** Lee un objeto completo en memoria (solo archivos chicos: falla si pasa `maxBytes`). */
  getBytes(key: string, maxBytes: number): Promise<Uint8Array>;
}

export class StorageNotConfiguredError extends Error {}

let cached: ObjectStorage | undefined;

export function objectStorage(): ObjectStorage {
  if (cached) return cached;
  const { S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_BUCKET || !S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new StorageNotConfiguredError("Faltan S3_BUCKET/S3_ENDPOINT/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY");
  }
  const client = new S3Client({
    region: S3_REGION || "auto",
    endpoint: S3_ENDPOINT,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  });
  cached = {
    async putStream(key, body, contentType) {
      await new Upload({
        client,
        params: { Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType },
        partSize: 5 * 1024 * 1024,
        queueSize: 2,
        leavePartsOnError: false, // un error aborta el multipart: no quedan objetos a medias
      }).done();
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        return true;
      } catch (error) {
        if ((error as { name?: string }).name === "NotFound") return false;
        throw error;
      }
    },
    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        return { bytes: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
      } catch (error) {
        if ((error as { name?: string }).name === "NotFound") return null;
        throw error;
      }
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    },
    async getBytes(key, maxBytes) {
      const res = await client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      const body = res.Body as Readable | undefined;
      if (!body) throw new Error("objeto vacío");
      // En streaming, contando bytes: se corta en cuanto pasa el límite (aunque
      // ContentLength falte o mienta) y el stream SIEMPRE se cierra.
      try {
        if ((res.ContentLength ?? 0) > maxBytes) throw new Error(`objeto de ${res.ContentLength} bytes; máximo ${maxBytes}`);
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          total += buf.byteLength;
          if (total > maxBytes) throw new Error(`objeto de más de ${maxBytes} bytes`);
          chunks.push(buf);
        }
        return new Uint8Array(Buffer.concat(chunks));
      } finally {
        body.destroy();
      }
    },
    signedGetUrl(key, expiresInSeconds, downloadName, disposition = "inline") {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          ...(downloadName
            ? { ResponseContentDisposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(downloadName)}` }
            : {}),
        }),
        { expiresIn: expiresInSeconds },
      );
    },
  };
  return cached;
}
