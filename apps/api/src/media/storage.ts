import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.ts";

export interface Storage {
  put(key: string, body: Uint8Array, contentType: string, options?: { cacheControl: string; signal: AbortSignal }): Promise<void>;
  get(key: string, signal: AbortSignal): Promise<Uint8Array | undefined>;
  signGet(key: string): Promise<string>;
}

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
    async put(key, body, contentType, options) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: options?.cacheControl ?? "private, max-age=31536000, immutable",
        }),
        { abortSignal: options?.signal },
      );
    },
    async get(key, signal) {
      const result = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { abortSignal: signal });
      return result.Body?.transformToByteArray();
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
    async get(key) {
      return objects.get(key)?.body;
    },
    async signGet(key) {
      return `memory://${key}`;
    },
  };
}

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
