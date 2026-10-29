import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Empty strings from forms mean "not set". */
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MESSAGE =
  'Slug yalnızca küçük harf, rakam ve tek tire içerebilir (ör. erkek-giyim)';

/** page/per_page like GET /companies. Query names are snake_case. */
class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page: number = 20;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ListCatalogQuery extends PageQuery {}

export class CreateCategoryDto {
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  name: string;

  @Transform(trim)
  @IsString()
  @MaxLength(160)
  @Matches(SLUG, { message: SLUG_MESSAGE })
  slug: string;

  /** null or omitted: a root category. */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

/** Omitted fields stay; `parentId: null` moves the category to the root. */
export class UpdateCategoryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  @Matches(SLUG, { message: SLUG_MESSAGE })
  slug?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class BrandDto {
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  name: string;
}

export class CreateVariantDto {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  sku: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(50)
  barcode?: string | null;
}

export class UpdateVariantDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  sku?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(50)
  barcode?: string | null;
}

export class CreateProductDto {
  @IsUUID()
  companyId: string;

  @Transform(trim)
  @IsString()
  @Length(1, 250)
  name: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatusValue;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  /** Every product has at least one variant: the SKU always lives there. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants: CreateVariantDto[];
}

/** The company cannot change. `status: 'archived'` archives the product. */
export class UpdateProductDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 250)
  name?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatusValue;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  brandId?: string | null;
}

export class ListProductsQuery extends PageQuery {
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatusValue;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  brand_id?: string;
}
