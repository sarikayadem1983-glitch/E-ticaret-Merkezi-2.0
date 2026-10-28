import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { isValidTaxNumber } from './tax-number.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Empty strings from forms mean "not set". */
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

@ValidatorConstraint({ name: 'taxNumber' })
class TaxNumberConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isValidTaxNumber(value);
  }
  defaultMessage() {
    return 'Geçerli bir VKN (10 hane) veya TCKN (11 hane) girin';
  }
}

export class CreateCompanyDto {
  @Transform(trim)
  @IsString()
  @Length(2, 250)
  legalName: string;

  @Transform(trim)
  @Matches(/^\d{10,11}$/, {
    message: 'Vergi numarası 10 veya 11 haneli olmalı',
  })
  @Validate(TaxNumberConstraint)
  taxNumber: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  taxOffice: string;

  @Transform(trim)
  @IsString()
  @Length(5, 500)
  addressLine: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  district: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  city: string;

  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^\d{5}$/, { message: 'Posta kodu 5 haneli olmalı' })
  postalCode?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^\+?[0-9 ()-]{7,30}$/, { message: 'Geçerli bir telefon girin' })
  phone?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsBoolean()
  eInvoiceEnabled?: boolean;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(250)
  eInvoiceAlias?: string | null;
}

/** Every field optional; the tax number cannot change after creation. */
export class UpdateCompanyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 250)
  legalName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  taxOffice?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  addressLine?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  district?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  city?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^\d{5}$/, { message: 'Posta kodu 5 haneli olmalı' })
  postalCode?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^\+?[0-9 ()-]{7,30}$/, { message: 'Geçerli bir telefon girin' })
  phone?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsBoolean()
  eInvoiceEnabled?: boolean;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(250)
  eInvoiceAlias?: string | null;
}

/** Query names follow the API convention (snake_case). */
export class ListCompaniesQuery {
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

  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'all';
}
