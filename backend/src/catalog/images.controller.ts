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
  RequestTimeoutException,
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
import { UploadGate } from './upload-gate.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

const READ_TIMEOUT_MS = 30_000;
/** Slots cover buffering and decoding; the database check runs before one is taken. */
const gate = new UploadGate(6, 2);

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
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > 2 * MAX_IMAGE_BYTES) throw tooLarge();
  const deadline = setTimeout(
    () => req.destroy(new Error('upload timeout')),
    READ_TIMEOUT_MS,
  );
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      // Slightly over: read on without storing, so the client gets the 413 answer.
      // Far over: stop reading, which closes the connection.
      if (size <= MAX_IMAGE_BYTES) chunks.push(chunk);
      if (size > 2 * MAX_IMAGE_BYTES) throw tooLarge();
    }
  } catch (error) {
    if (error instanceof PayloadTooLargeException) throw error;
    throw new RequestTimeoutException({
      code: 'UPLOAD_INCOMPLETE',
      message: 'Görsel alınamadı, tekrar deneyin',
    });
  } finally {
    clearTimeout(deadline);
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
    return gate.run(user.tid, async () =>
      this.images.upload(user, id, q.variant_id, await readBody(req)),
    );
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
