import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AMOUNT_PATTERN, CURRENCIES } from '../catalog/pricing.js';
import { ORDER_STATUSES, type OrderStatus } from './order-status.js';

const AMOUNT_MESSAGE =
  'Tutar en çok 2 ondalık basamaklı ve noktalı olmalı (ör. 199.90)';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** page/per_page like the other list endpoints. Query names are snake_case. */
export class ListOrdersQuery {
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
  @IsUUID()
  company_id?: string;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(50)
  channel?: string;

  /** Marketplace order number (prefix match). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class OrderItemInputDto {
  @IsUUID()
  variantId: string;

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity: number;

  /** VAT-inclusive unit price, decimal string (never a JSON number). */
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  unitPrice: string;

  @IsOptional()
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  discount?: string;
}

/** A manual order (channel "manual"). Marketplace orders come from INT-TY-03. */
export class CreateOrderDto {
  @IsUUID()
  companyId: string;

  @IsIn(CURRENCIES)
  currency: string;

  @IsOptional()
  @IsDateString({ strict: true })
  orderedAt?: string;

  @IsOptional()
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  discountTotal?: string;

  @IsOptional()
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  shippingTotal?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];
}

export class ChangeStatusDto {
  @IsIn(ORDER_STATUSES)
  status: OrderStatus;
}
