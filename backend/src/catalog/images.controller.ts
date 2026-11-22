import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { MAX_IMAGE_BYTES } from './image-processing.js';
import {
  ImageOrderDto,
  ImageVariantDto,
  UploadImageQuery,
} from './images.dto.js';
import { ImagesService } from './images.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

const tooLarge = () =>
  new PayloadTooLargeException({
    code: 'PAYLOAD_TOO_LARGE',
    message: `Görsel en çok ${MAX_IMAGE_BYTES / 1024 / 1024} MB olabilir`,
  });

/**
 * Reads the raw body here, after the guards and the product permission check, so nobody
 * without write access can make the server buffer megabytes.
 */
async function readBody(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    // Over the limit: keep reading but store nothing, so the client gets the 413 answer.
    if (size <= MAX_IMAGE_BYTES) chunks.push(chunk);
  }
  if (size > MAX_IMAGE_BYTES) throw tooLarge();
  return Buffer.concat(chunks);
}

/** Product images (IMG-01). Same company rules as products: no role 404, read-only 403. */
@Controller('products/:id/images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get()
  @RequirePermissions('products:read')
  list(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.images.list(user, id);
  }

  @Post()
  @RequirePermissions('products:write')
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Query() q: UploadImageQuery,
    @Req() req: Request,
  ) {
    if (!req.is('application/octet-stream')) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Görsel application/octet-stream olarak gönderilmeli',
      });
    }
    await this.images.assertUploadable(user, id, q.variant_id);
    return this.images.upload(user, id, q.variant_id, await readBody(req));
  }

  @Put('order')
  @RequirePermissions('products:write')
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: ImageOrderDto,
  ) {
    return this.images.reorder(user, id, dto.imageIds);
  }

  @Patch(':imageId')
  @RequirePermissions('products:write')
  bind(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('imageId', uuid) imageId: string,
    @Body() dto: ImageVariantDto,
  ) {
    return this.images.bind(user, id, imageId, dto.variantId);
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('products:write')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('imageId', uuid) imageId: string,
  ) {
    return this.images.remove(user, id, imageId);
  }
}
