import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  NotEquals,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListByCompanyQuery {
  @IsOptional()
  @IsUUID()
  company_id?: string;
}

export class CreateWarehouseDto {
  @IsUUID()
  companyId: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class ListLevelsQuery {
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
  per_page: number = 50;

  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsOptional()
  @IsUUID()
  warehouse_id?: string;

  @IsOptional()
  @IsUUID()
  variant_id?: string;
}

/** Manual movements only; order movements come from reservations (stock_consume). */
export const MANUAL_REASONS = [
  'opening',
  'adjustment',
  'count',
  'purchase',
] as const;

export class CreateMovementDto {
  @IsUUID()
  warehouseId: string;

  @IsUUID()
  variantId: string;

  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  @Min(-1000000)
  @Max(1000000)
  quantity: number;

  @IsIn(MANUAL_REASONS)
  reason: (typeof MANUAL_REASONS)[number];
}

export class ListMovementsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @IsUUID()
  warehouse_id?: string;

  @IsOptional()
  @IsUUID()
  variant_id?: string;
}

export class ReserveOrderDto {
  /** Default: the company's default warehouse. */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
