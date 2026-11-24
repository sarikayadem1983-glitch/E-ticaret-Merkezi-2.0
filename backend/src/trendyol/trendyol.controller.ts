import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { MANAGE } from '../channels/channels.service.js';
import { SyncService } from '../sync/sync.service.js';
import { TRENDYOL_PRODUCTS_PULL } from './trendyol-products.sync.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** One pull per account per minute: a double click returns the same job. */
export function pullKey(now: Date = new Date()): string {
  return `products-pull:${now.toISOString().slice(0, 16)}`;
}

/** INT-TY-01a: starts the read-only Trendyol product pull + match. */
@Controller('companies/:companyId/channel-accounts/:accountId/trendyol')
export class TrendyolController {
  constructor(private readonly sync: SyncService) {}

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
}
