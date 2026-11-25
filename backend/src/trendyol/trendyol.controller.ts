import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { MANAGE } from '../channels/channels.service.js';
import { SyncService } from '../sync/sync.service.js';
import { AccessService } from '../access/access.service.js';
import {
  TRENDYOL_PRODUCTS_IMPORT,
  TRENDYOL_PRODUCTS_PULL,
} from './trendyol-products.sync.js';
import { TRENDYOL_STOCK_PRICE_PULL } from './trendyol-stock-price.sync.js';
import {
  parsePushPayload,
  TRENDYOL_STOCK_PRICE_PUSH,
} from './trendyol-stock-price-push.sync.js';
import { SyncError } from '../sync/sync-errors.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** One pull per account per minute: a double click returns the same job. */
export function pullKey(now: Date = new Date()): string {
  return `products-pull:${now.toISOString().slice(0, 16)}`;
}

/** INT-TY-01a: starts the read-only Trendyol product pull + match. */
@Controller('companies/:companyId/channel-accounts/:accountId/trendyol')
export class TrendyolController {
  constructor(
    private readonly sync: SyncService,
    private readonly access: AccessService,
  ) {}

  @Post('products-pull')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(MANAGE)
  async pull(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('accountId', uuid) accountId: string,
  ) {
    const job = await this.sync.start(user, {
      companyId,
      channelAccountId: accountId,
      kind: TRENDYOL_PRODUCTS_PULL,
      payload: {},
      idempotencyKey: pullKey(),
    });
    return { data: job };
  }

  /**
   * Pull + match, then creates draft local products for unmatched Trendyol
   * products (read-only towards Trendyol). Needs products:write as well.
   */
  @Post('products-import')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(MANAGE)
  async import(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('accountId', uuid) accountId: string,
  ) {
    await this.access.assertCompanyPermission(
      user,
      companyId,
      'products:write',
    );
    const job = await this.sync.start(user, {
      companyId,
      channelAccountId: accountId,
      kind: TRENDYOL_PRODUCTS_IMPORT,
      payload: { actorUserId: user.sub },
      idempotencyKey: pullKey().replace('products-pull', 'products-import'),
    });
    return { data: job };
  }

  /**
   * INT-TY-02a: reads Trendyol stock + sale price into linked local variants
   * (read-only towards Trendyol). Writes prices and opening stock: needs
   * products:write and inventory:write as well.
   */
  @Post('stock-price-pull')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(MANAGE)
  async stockPrice(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('accountId', uuid) accountId: string,
  ) {
    await this.access.assertCompanyPermission(
      user,
      companyId,
      'products:write',
    );
    await this.access.assertCompanyPermission(
      user,
      companyId,
      'inventory:write',
    );
    const job = await this.sync.start(user, {
      companyId,
      channelAccountId: accountId,
      kind: TRENDYOL_STOCK_PRICE_PULL,
      payload: { actorUserId: user.sub },
      idempotencyKey: pullKey().replace('products-pull', 'stock-price-pull'),
    });
    return { data: job };
  }

  /**
   * INT-TY-02b: WRITES local stock and the Trendyol price of the given
   * variants (1–50) to Trendyol. Manual only. Needs products:write and
   * inventory:write for the company. The same selection within a minute
   * returns the same job.
   */
  @Post('stock-price-push')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(MANAGE)
  async stockPricePush(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('accountId', uuid) accountId: string,
    @Body() body: { variantIds?: unknown },
  ) {
    let payload;
    try {
      payload = parsePushPayload({
        actorUserId: user.sub,
        variantIds: body?.variantIds,
      });
    } catch (e) {
      if (!(e instanceof SyncError)) throw e;
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Geçersiz istek',
        errors: [{ field: 'variantIds', message: '1–50 benzersiz varyant id' }],
      });
    }
    // Writes to the live store: needs write rights on both sides.
    await this.access.assertCompanyPermission(
      user,
      companyId,
      'products:write',
    );
    await this.access.assertCompanyPermission(
      user,
      companyId,
      'inventory:write',
    );
    const selection = createHash('sha256')
      .update([...payload.variantIds].sort().join(','))
      .digest('hex')
      .slice(0, 16);
    const job = await this.sync.start(user, {
      companyId,
      channelAccountId: accountId,
      kind: TRENDYOL_STOCK_PRICE_PUSH,
      payload: { ...payload },
      idempotencyKey: `stock-price-push:${new Date().toISOString().slice(0, 16)}:${selection}`,
    });
    return { data: job };
  }
}
