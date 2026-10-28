import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators.js';
import { ListAuditLogsQuery } from './audit.dto.js';
import { AuditService } from './audit.service.js';

/** Read-only by design: no endpoint creates, changes or deletes audit logs. */
@Controller('audit-logs')
@RequirePermissions('audit:read')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() q: ListAuditLogsQuery) {
    return this.audit.list(
      {
        action: q.action,
        module: q.module,
        entityType: q.entity_type,
        entityId: q.entity_id,
        actorUserId: q.actor_user_id,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
      },
      q.page,
      q.per_page,
    );
  }

  @Get(':id')
  get(
    @Param(
      'id',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    )
    id: string,
  ) {
    return this.audit.get(id);
  }
}
