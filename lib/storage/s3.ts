// Almacenamiento de archivos del CRM: Railway Storage Bucket (compatible con
// S3, privado). Sin terceros: el bucket es de Railway, igual que la base.
// Variables (referencias al bucket en Railway): S3_BUCKET, S3_ENDPOINT,
// S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
import type { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
  /** URL firmada y temporal para ver/descargar un objeto privado. */
  signedGetUrl(key: string, expiresInSeconds: number, downloadName?: string): Promise<string>;
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
    signedGetUrl(key, expiresInSeconds, downloadName) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          ...(downloadName
            ? { ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(downloadName)}` }
            : {}),
        }),
        { expiresIn: expiresInSeconds },
      );
    },
  };
  return cached;
}
