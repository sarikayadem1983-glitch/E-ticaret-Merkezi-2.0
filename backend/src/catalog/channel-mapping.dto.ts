import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ChannelValueDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  externalId!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;
}

export class ChannelAttributeDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  externalId!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsBoolean()
  required!: boolean;

  @IsBoolean()
  variesByVariant!: boolean;

  @IsBoolean()
  allowCustom!: boolean;

  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ChannelValueDto)
  values!: ChannelValueDto[];
}

export class ChannelCategoryDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  externalId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  parentExternalId?: string | null;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsBoolean()
  isLeaf!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ChannelAttributeDto)
  attributes?: ChannelAttributeDto[];
}

/** Full tree of one channel. Replaces the stored tree: missing nodes are soft-deleted. */
export class ImportChannelTreeDto {
  @IsArray()
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => ChannelCategoryDto)
  categories!: ChannelCategoryDto[];
}

export class ListChannelCategoriesQuery {
  /** Children of this node; omitted = root nodes. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  parent?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class MapCategoryDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  channelCategoryExternalId!: string;
}

export class MapAttributeDto {
  @IsUUID()
  attributeId!: string;
}

export class ProductChannelValueDto {
  @IsUUID()
  channelAttributeId!: string;

  /** Allowed value's externalId; or omit and send `value` when custom values are allowed. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  valueExternalId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  value?: string;
}

export class SetProductChannelValuesDto {
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ProductChannelValueDto)
  values!: ProductChannelValueDto[];
}
