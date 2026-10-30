import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

export const notFound = (message: string) =>
  new NotFoundException({ code: 'NOT_FOUND', message });

export const unavailable = (code: string, message: string) =>
  new UnprocessableEntityException({ code, message });

export const conflict = (code: string, message: string) =>
  new ConflictException({ code, message });

/** Unique violations, keyed by a word that appears in the field list or index name. */
const UNIQUE_CONFLICTS: [RegExp, string, string][] = [
  [/sku/i, 'SKU_TAKEN', 'Bu SKU kullanılmış (silinen varyantlar dahil)'],
  [
    /barcode/i,
    'BARCODE_TAKEN',
    'Bu barkod kullanılmış (silinen varyantlar dahil)',
  ],
  [/slug/i, 'CATEGORY_SLUG_TAKEN', 'Bu kategori adresi (slug) kullanılıyor'],
  [/brands|name/i, 'BRAND_NAME_TAKEN', 'Bu marka zaten var'],
];

/**
 * Maps database errors of catalog writes to stable API errors: unique
 * violations to 409 with a specific code, serialization failures to 409
 * CONCURRENT_UPDATE. Anything else is rethrown unchanged.
 */
export function mapCatalogError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const where = JSON.stringify(error.meta ?? {}) + error.message;
      const hit = UNIQUE_CONFLICTS.find(([re]) => re.test(where));
      if (hit) throw conflict(hit[1], hit[2]);
    }
    if (error.code === 'P2034') {
      throw conflict(
        'CONCURRENT_UPDATE',
        'Kayıt aynı anda değiştirildi, tekrar deneyin',
      );
    }
  }
  throw error;
}
