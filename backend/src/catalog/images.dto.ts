import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { MAX_IMAGES_PER_PRODUCT } from './image-processing.js';

export class UploadImageQuery {
  @IsOptional()
  @IsUUID()
  variant_id?: string;
}

export class ImageOrderDto {
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES_PER_PRODUCT)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  imageIds: string[];
}

export class ImageVariantDto {
  /** null: the image belongs to the whole product. */
  @ValidateIf((o: ImageVariantDto) => o.variantId !== null)
  @IsUUID()
  variantId: string | null;
}
