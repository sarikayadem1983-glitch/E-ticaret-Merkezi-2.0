import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { ProductsService } from '../catalog/products.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { toCsv, trAmount } from './csv-writer.js';
import { COLUMNS } from './product-csv.js';

export const MAX_EXPORT_ROWS = 20000;

const tooLarge = () =>
  new UnprocessableEntityException({
    code: 'EXPORT_TOO_LARGE',
    message: `En çok ${MAX_EXPORT_ROWS} satır dışa aktarılabilir; firma seçerek daraltın`,
  });

const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * Exports (IMP-04): only the companies the member may read (company roles from the
 * database). The product file has exactly the import columns, so it can be edited and
 * imported again; the stock file is for reading. Formula cells are neutralised.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly access: AccessService,
    private readonly catalog: ProductsService,
    private readonly inventory: InventoryService,
  ) {}

  private async companies(
    user: AuthUser,
    permission: string,
    companyId?: string,
  ) {
    const scope = await this.access.companyScope(user, permission);
    if (scope === null) return companyId ? [companyId] : undefined;
    return companyId ? scope.filter((id) => id === companyId) : scope;
  }

  async products(user: AuthUser, companyId?: string) {
    const ids = await this.companies(user, 'products:read', companyId);
    const rows =
      ids && ids.length === 0
        ? []
        : await this.catalog.exportRows(ids, MAX_EXPORT_ROWS);
    if (rows.length > MAX_EXPORT_ROWS) throw tooLarge();
    const csv = toCsv(
      COLUMNS.map((c) => c.key),
      rows.map((r) => [
        r.name,
        r.sku,
        r.barcode,
        r.vatRate,
        r.price ? trAmount(r.price.amount) : null,
        r.price?.currency ?? null,
      ]),
    );
    return {
      data: { filename: `urunler-${stamp()}.csv`, rows: rows.length, csv },
    };
  }

  async stock(user: AuthUser, companyId?: string) {
    const all = [];
    for (let page = 1; ; page++) {
      const res = await this.inventory.listLevels(user, {
        page,
        per_page: 100,
        company_id: companyId,
      });
      all.push(...res.data);
      if (all.length > MAX_EXPORT_ROWS) throw tooLarge();
      if (res.data.length < 100) break;
    }
    const csv = toCsv(
      [
        'urun_adi',
        'sku',
        'depo',
        'eldeki',
        'ayrilmis',
        'kullanilabilir',
        'esik',
      ],
      all.map((l) => [
        l.productName,
        l.sku,
        l.warehouseName,
        l.onHand,
        l.reserved,
        l.available,
        l.threshold,
      ]),
    );
    return { data: { filename: `stok-${stamp()}.csv`, rows: all.length, csv } };
  }
}
