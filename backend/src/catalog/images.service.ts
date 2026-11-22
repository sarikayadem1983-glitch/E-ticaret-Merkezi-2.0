import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { RateLimiterService } from '../rate-limit/rate-limiter.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { conflict, notFound, unavailable } from './catalog.errors.js';
import { CatalogRepository } from './catalog.repository.js';
import { catalogWrite, MODULE } from './catalog.tx.js';
import { MAX_IMAGES_PER_PRODUCT, processImage } from './image-processing.js';
import { ProductsService } from './products.service.js';

const UPLOADS_PER_USER = { limit: 60, windowMs: 60_000 };

const FIELDS = {
  id: true,
  productId: true,
  variantId: true,
  storageKey: true,
  contentType: true,
  width: true,
  height: true,
  byteSize: true,
  position: true,
  createdAt: true,
} satisfies Prisma.ProductImageSelect;

type Row = Prisma.ProductImageGetPayload<{ select: typeof FIELDS }>;

/** Audit shape: the internal storage path stays out of the log. */
const audited = ({ storageKey: _key, ...row }: Row) => row;

/** Product images (IMG-01). Permissions are the product's; objects live under the tenant prefix. */
@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly repository: CatalogRepository,
    private readonly products: ProductsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiterService,
  ) {}

  private rows(
    productId: string,
    db: PrismaTx = this.repository.prisma,
  ): Promise<Row[]> {
    return db.productImage.findMany({
      where: { productId, deletedAt: null },
      select: FIELDS,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async find(productId: string, id: string, tx: PrismaTx) {
    const row = await tx.productImage.findFirst({
      where: { id, productId, deletedAt: null },
      select: FIELDS,
    });
    if (!row) throw notFound('Görsel bulunamadı');
    return row;
  }

  /** API shape: a short-lived signed URL instead of the storage key. */
  private async shape({ storageKey, ...row }: Row) {
    const tenantId = TenantContext.requireTenantId();
    return { ...row, url: await this.storage.signedUrl(tenantId, storageKey) };
  }

  private async listed(productId: string) {
    const rows = await this.rows(productId);
    return { data: await Promise.all(rows.map((r) => this.shape(r))) };
  }

  async list(user: AuthUser, productId: string) {
    await this.products.get(user, productId);
    return this.listed(productId);
  }

  private async assertVariant(
    productId: string,
    variantId: string | null | undefined,
    tx: PrismaTx,
  ) {
    if (!variantId) return;
    if (!(await this.repository.findVariant(productId, variantId, tx))) {
      throw notFound('Varyant bulunamadı');
    }
  }

  private async assertRoom(productId: string, tx: PrismaTx): Promise<Row[]> {
    const rows = await this.rows(productId, tx);
    if (rows.length >= MAX_IMAGES_PER_PRODUCT) {
      throw conflict(
        'IMAGE_LIMIT',
        `Bir ürüne en çok ${MAX_IMAGES_PER_PRODUCT} görsel eklenebilir`,
      );
    }
    return rows;
  }

  private record(
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    entityId: string,
    before: unknown,
    after: unknown,
    tx: PrismaTx,
  ) {
    return this.audit.record(
      {
        action,
        module: MODULE,
        entityType: 'ProductImage',
        entityId,
        before,
        after,
      },
      tx,
    );
  }

  /** Everything that can refuse an upload without its bytes. */
  async assertUploadable(
    user: AuthUser,
    productId: string,
    variantId?: string,
  ): Promise<void> {
    this.storage.assertEnabled();
    await this.limiter.hit(
      `image-upload:${user.tid}:${user.sub}`,
      UPLOADS_PER_USER,
    );
    await catalogWrite(this.repository.prisma, async (tx) => {
      await this.products.accessible(user, productId, true, tx);
      await this.assertVariant(productId, variantId, tx);
      await this.assertRoom(productId, tx);
    });
  }

  async upload(
    user: AuthUser,
    productId: string,
    variantId: string | undefined,
    input: Buffer,
  ) {
    const tenantId = TenantContext.requireTenantId();
    const image = await processImage(input);
    const storageKey = await this.storage.put(
      tenantId,
      ['products', productId],
      image.body,
      image.contentType,
      image.extension,
    );
    try {
      const row = await catalogWrite(this.repository.prisma, async (tx) => {
        // Again: permissions, variant and count may have changed during the upload.
        const product = await this.products.accessible(
          user,
          productId,
          true,
          tx,
        );
        await this.assertVariant(productId, variantId, tx);
        const existing = await this.assertRoom(productId, tx);
        const created = await tx.productImage.create({
          data: {
            tenantId,
            companyId: product.companyId,
            productId,
            variantId: variantId ?? null,
            storageKey,
            contentType: image.contentType,
            width: image.width,
            height: image.height,
            byteSize: image.body.byteLength,
            position: (existing.at(-1)?.position ?? -1) + 1,
          },
          select: FIELDS,
        });
        await this.record('CREATE', created.id, undefined, audited(created), tx);
        return created;
      });
      return { data: await this.shape(row) };
    } catch (error) {
      await this.discard(tenantId, storageKey);
      throw error;
    }
  }

  /** The new order must name every current image exactly once (stale lists are refused). */
  async reorder(user: AuthUser, productId: string, imageIds: string[]) {
    await catalogWrite(this.repository.prisma, async (tx) => {
      await this.products.accessible(user, productId, true, tx);
      const byId = new Map(
        (await this.rows(productId, tx)).map((r) => [r.id, r]),
      );
      const rows = imageIds.map((id) => byId.get(id));
      if (byId.size !== rows.length) throw this.orderMismatch();
      for (const [position, before] of rows.entries()) {
        if (!before) throw this.orderMismatch();
        if (before.position === position) continue;
        await tx.productImage.update({
          where: { id: before.id },
          data: { position },
        });
        await this.record(
          'UPDATE',
          before.id,
          { position: before.position },
          { position },
          tx,
        );
      }
    });
    return this.listed(productId);
  }

  private orderMismatch() {
    return unavailable(
      'IMAGE_ORDER_MISMATCH',
      'Sıralama ürünün güncel görselleriyle eşleşmiyor',
    );
  }

  async bind(
    user: AuthUser,
    productId: string,
    imageId: string,
    variantId: string | null,
  ) {
    const row = await catalogWrite(this.repository.prisma, async (tx) => {
      await this.products.accessible(user, productId, true, tx);
      const before = await this.find(productId, imageId, tx);
      await this.assertVariant(productId, variantId, tx);
      const after = await tx.productImage.update({
        where: { id: imageId },
        data: { variantId },
        select: FIELDS,
      });
      await this.record(
        'UPDATE',
        imageId,
        { variantId: before.variantId },
        { variantId },
        tx,
      );
      return after;
    });
    return { data: await this.shape(row) };
  }

  async remove(
    user: AuthUser,
    productId: string,
    imageId: string,
  ): Promise<void> {
    const tenantId = TenantContext.requireTenantId();
    const row = await catalogWrite(this.repository.prisma, async (tx) => {
      await this.products.accessible(user, productId, true, tx);
      const before = await this.find(productId, imageId, tx);
      await tx.productImage.update({
        where: { id: imageId },
        data: { deletedAt: new Date() },
      });
      await this.record('DELETE', imageId, audited(before), undefined, tx);
      return before;
    });
    await this.discard(tenantId, row.storageKey);
  }

  /** Best effort: a left-over object is unreachable (no active row points to it). */
  private async discard(tenantId: string, key: string): Promise<void> {
    try {
      await this.storage.remove(tenantId, key);
    } catch {
      this.logger.warn(`Görsel nesnesi silinemedi, depoda sahipsiz: ${key}`);
    }
  }
}
