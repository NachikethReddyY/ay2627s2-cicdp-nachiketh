import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.ts";

export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  signGet(key: string): Promise<string>;
}

// Signed URLs live 2h from the start of the current hour, so every request in an hour gets the same URL
// and the browser cache hits; a URL is valid for at least an hour.
const SIGN_TTL_SECONDS = 7200;
const hourStart = () => new Date(Math.floor(Date.now() / 3600_000) * 3600_000);

export function s3Storage(cfg: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}): Storage {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Keys are UUIDs and never change, so a cached copy never goes stale.
          CacheControl: "private, max-age=31536000, immutable",
        }),
      );
    },
    signGet(key) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
        expiresIn: SIGN_TTL_SECONDS,
        signingDate: hourStart(),
      });
    },
  };
}

export function memoryStorage(): Storage & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async signGet(key) {
      return `memory://${key}`;
    },
  };
}

// Picked once at startup from env; tests swap it with setStorage.
export let storage: Storage | null = env.S3_BUCKET
  ? s3Storage({
      endpoint: env.S3_ENDPOINT!,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      region: env.S3_REGION,
    })
  : null;

export function setStorage(next: Storage | null) {
  storage = next;
}
