import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import {
  ImportChannelTreeDto,
  ListChannelCategoriesQuery,
  MapAttributeDto,
  MapCategoryDto,
  SetProductChannelValuesDto,
} from './channel-mapping.dto.js';
import { ChannelMappingService } from './channel-mapping.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
const TENANT_WRITE = ['products:write', 'companies:all'];

/** CAT-06: channel category trees, mappings and listing readiness. */
@Controller()
export class ChannelMappingController {
  constructor(private readonly mapping: ChannelMappingService) {}

  @Put('channel-categories/:channel')
  @RequirePermissions(...TENANT_WRITE)
  importTree(
    @CurrentUser() user: AuthUser,
    @Param('channel') channel: string,
    @Body() dto: ImportChannelTreeDto,
  ) {
    return this.mapping.importTree(user, channel, dto);
  }

  @Get('channel-categories/:channel')
  @RequirePermissions('products:read')
  list(
    @Param('channel') channel: string,
    @Query() q: ListChannelCategoriesQuery,
  ) {
    return this.mapping.listCategories(channel, q);
  }

  @Get('channel-categories/:channel/:externalId/attributes')
  @RequirePermissions('products:read')
  attributes(
    @Param('channel') channel: string,
    @Param('externalId') externalId: string,
  ) {
    return this.mapping.categoryAttributes(channel, externalId);
  }

  @Put('categories/:id/channel-mappings/:channel')
  @RequirePermissions(...TENANT_WRITE)
  mapCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('channel') channel: string,
    @Body() dto: MapCategoryDto,
  ) {
    return this.mapping.mapCategory(user, id, channel, dto);
  }

  @Delete('categories/:id/channel-mappings/:channel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(...TENANT_WRITE)
  unmapCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('channel') channel: string,
  ) {
    return this.mapping.unmapCategory(user, id, channel);
  }

  @Put('channel-attributes/:id/mapping')
  @RequirePermissions(...TENANT_WRITE)
  mapAttribute(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: MapAttributeDto,
  ) {
    return this.mapping.mapAttribute(user, id, dto);
  }

  @Put('products/:id/channel-values/:channel')
  @RequirePermissions('products:write')
  setValues(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('channel') channel: string,
    @Body() dto: SetProductChannelValuesDto,
  ) {
    return this.mapping.setProductValues(user, id, channel, dto);
  }

  @Get('products/:id/channel-readiness/:channel')
  @RequirePermissions('products:read')
  readiness(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('channel') channel: string,
  ) {
    return this.mapping.readiness(user, id, channel);
  }
}
