import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import {
  CreateCompanyDto,
  ListCompaniesQuery,
  UpdateCompanyDto,
} from './companies.dto.js';
import { CompaniesService } from './companies.service.js';

const uuid = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.NOT_FOUND,
});

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermissions('companies:read')
  list(@CurrentUser() user: AuthUser, @Query() q: ListCompaniesQuery) {
    return this.companies.list(user, q);
  }

  @Get('summary')
  @RequirePermissions('companies:read')
  summary(@CurrentUser() user: AuthUser) {
    return this.companies.summary(user);
  }

  @Get(':id')
  @RequirePermissions('companies:read')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.companies.get(user, id);
  }

  /** Creating a company needs tenant-wide access: a new company has no assignments yet. */
  @Post()
  @RequirePermissions('companies:write', 'companies:all')
  create(@Body() dto: CreateCompanyDto) {
    return this.companies.create(dto);
  }

  // Writes on one company: the guard only checks membership in the module
  // (companies:read). The service decides from the role in that company:
  // no role → 404, read-only role → 403.
  @Patch(':id')
  @RequirePermissions('companies:read')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.update(user, id, dto);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('companies:read')
  deactivate(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.companies.setActive(user, id, false);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('companies:read')
  activate(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.companies.setActive(user, id, true);
  }
}
