import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { assertTenantKey, newObjectKey, ObjectKeyError } from './object-key.js';
import type { StorageConfig } from './storage.config.js';

export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');
export const STORAGE_CLIENT = Symbol('STORAGE_CLIENT');

/** The subset of S3Client the service uses (tests pass a fake). */
export interface StorageClient {
  send: S3Client['send'];
}

export type Signer = (
  client: StorageClient,
  command: GetObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

export const STORAGE_SIGNER = Symbol('STORAGE_SIGNER');
export const defaultSigner: Signer = (client, command, options) =>
  getSignedUrl(client as S3Client, command, options);

export function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/**
 * Tenant-scoped object storage (INF-12). Every method takes the caller's tenant id and
 * refuses keys outside `tenants/<tenantId>/`, so a tenant cannot store, sign or delete
 * another tenant's object. Callers (e.g. IMG-01) still check company permissions first.
 * The bucket is private; objects are only reachable through short-lived signed URLs.
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig | undefined,
    @Inject(STORAGE_CLIENT) private readonly client: StorageClient | undefined,
    @Inject(STORAGE_SIGNER) private readonly signer: Signer,
  ) {}

  get enabled(): boolean {
    return this.config !== undefined && this.client !== undefined;
  }

  private ready(): { config: StorageConfig; client: StorageClient } {
    if (!this.config || !this.client) {
      throw new ServiceUnavailableException({
        code: 'STORAGE_DISABLED',
        message: 'Dosya depolama yapılandırılmamış',
      });
    }
    return { config: this.config, client: this.client };
  }

  private checkKey(tenantId: string, key: string): void {
    try {
      assertTenantKey(tenantId, key);
    } catch (error) {
      if (error instanceof ObjectKeyError) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Bu dosyaya erişim yetkiniz yok',
        });
      }
      throw error;
    }
  }

  /** Stores bytes under a new tenant-prefixed key and returns the key. */
  async put(
    tenantId: string,
    segments: string[],
    body: Uint8Array,
    contentType: string,
    extension?: string,
  ): Promise<string> {
    const { config, client } = this.ready();
    const key = newObjectKey(tenantId, segments, extension);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
    );
    return key;
  }

  /** Short-lived GET URL for one of the tenant's own objects. */
  async signedUrl(tenantId: string, key: string): Promise<string> {
    const { config, client } = this.ready();
    this.checkKey(tenantId, key);
    return this.signer(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: config.signedUrlTtlSeconds },
    );
  }

  /** Deletes one of the tenant's own objects (missing objects are not an error). */
  async remove(tenantId: string, key: string): Promise<void> {
    const { config, client } = this.ready();
    this.checkKey(tenantId, key);
    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
    );
  }
}
