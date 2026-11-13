import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { MANAGE } from '../channels/channels.service.js';
import { SyncService } from './sync.service.js';
import { SYNC_STATUSES, type SyncStatus } from './sync.types.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

export class ListSyncJobsQuery {
  @IsOptional()
  @IsIn(SYNC_STATUSES)
  status?: SyncStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

/** INT-02 sync log of a channel account. Same permission as the account itself. */
@Controller('companies/:companyId/channel-accounts/:accountId/sync-jobs')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get()
  @RequirePermissions(MANAGE)
  list(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('accountId', uuid) accountId: string,
    @Query() query: ListSyncJobsQuery,
  ) {
    return this.sync.list(user, companyId, accountId, query);
  }

  @Post(':syncJobId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(MANAGE)
  async retry(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('accountId', uuid) accountId: string,
    @Param('syncJobId', uuid) syncJobId: string,
  ) {
    await this.sync.retry(user, companyId, accountId, syncJobId);
    return { data: { message: 'İş yeniden kuyruğa alındı.' } };
  }
}
