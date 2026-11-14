import {
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AccessService } from '../access/access.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { ProductsService } from '../catalog/products.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import { MAX_BYTES, type RowError, validate } from './product-csv.js';

/** Human-readable text of a Nest HTTP error (its response message) or any error. */
function errorText(error: unknown): string {
  if (error instanceof HttpException) {
    const res = error.getResponse();
    if (typeof res === 'string') return res;
    const msg = (res as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
    if (Array.isArray(msg)) return msg.map(String).join(', ');
  }
  return error instanceof Error ? error.message : 'Beklenmeyen hata';
}

export class ImportProductsDto {
  @IsUUID()
  companyId: string;

  @IsString()
  @MaxLength(MAX_BYTES)
  csv: string;

  /** Default true: nothing is written unless dryRun is explicitly false. */
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value !== false && value !== 'false',
  )
  @IsBoolean()
  dryRun: boolean = true;
}

/**
 * Product import (IMP-01), synchronous with a row limit (IMP-02 adds the queue). A dry run
 * validates every row (format, CSV injection, duplicates in the file and against existing
 * SKUs/barcodes) and writes nothing. A real run only starts when the dry run is clean;
 * products are then created one by one through ProductsService (same rules and audit as
 * the API). If one fails (e.g. a SKU taken in the meantime) the import stops and reports
 * what was created.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly access: AccessService,
    private readonly companies: CompaniesService,
    private readonly products: ProductsService,
  ) {}

  async importProducts(user: AuthUser, dto: ImportProductsDto) {
    try {
      await this.access.assertCompanyPermission(
        user,
        dto.companyId,
        'products:write',
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Firma bulunamadı',
        });
      }
      throw error;
    }
    if (
      !(await this.companies.namesByIds([dto.companyId])).has(dto.companyId)
    ) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Firma bulunamadı',
      });
    }

    const parsed = validate(dto.csv);
    const errors: RowError[] = [...parsed.errors];
    const variants = parsed.products.flatMap((p) => p.variants);
    const taken = await this.products.takenIdentifiers(
      variants.map((v) => v.sku),
      variants.flatMap((v) => (v.barcode ? [v.barcode] : [])),
    );
    for (const v of variants) {
      if (taken.skus.has(v.sku.toLowerCase())) {
        errors.push({
          row: v.row,
          column: 'sku',
          message: 'Bu SKU zaten kayıtlı (silinmiş ürünler dahil)',
        });
      }
      if (v.barcode && taken.barcodes.has(v.barcode)) {
        errors.push({
          row: v.row,
          column: 'barkod',
          message: 'Bu barkod zaten kayıtlı',
        });
      }
    }
    errors.sort((a, b) => a.row - b.row);
    const report = {
      rows: parsed.rows,
      products: parsed.products.length,
      variants: variants.length,
      errors,
      dryRun: dto.dryRun,
      created: 0,
    };
    if (dto.dryRun || errors.length > 0) return { data: report };

    const createdIds: string[] = [];
    for (const p of parsed.products) {
      try {
        const res = await this.products.create(user, {
          companyId: dto.companyId,
          name: p.name,
          vatRate: p.vatRate,
          variants: p.variants.map((v) => ({
            sku: v.sku,
            barcode: v.barcode,
            prices: v.price ? [{ channel: 'list', ...v.price }] : undefined,
          })),
        });
        createdIds.push(res.data.id);
      } catch (error) {
        const message = errorText(error);
        throw new UnprocessableEntityException({
          code: 'IMPORT_STOPPED',
          message: `İçe aktarma ${p.variants[0].row}. satırda durdu (${createdIds.length} ürün oluşturuldu): ${message}`,
          errors: [{ field: `row.${p.variants[0].row}`, message }],
        });
      }
    }
    return {
      data: { ...report, created: createdIds.length, productIds: createdIds },
    };
  }
}
