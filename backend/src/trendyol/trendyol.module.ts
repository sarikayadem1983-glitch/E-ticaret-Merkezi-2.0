import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import {
  TrendyolAdapter,
  trendyolBaseUrl,
} from '../channels/trendyol.adapter.js';
import { SyncModule } from '../sync/sync.module.js';
import {
  TRENDYOL_ADAPTER,
  TrendyolProductsSync,
} from './trendyol-products.sync.js';
import { TrendyolController } from './trendyol.controller.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { TrendyolStockPriceSync } from './trendyol-stock-price.sync.js';
import { TrendyolStockPricePush } from './trendyol-stock-price-push.sync.js';
import { OrdersModule } from '../orders/orders.module.js';
import { TrendyolOrdersSync } from './trendyol-orders.sync.js';

/** Trendyol sync kinds (INT-TY-*). Registers them with the INT-02 engine. */
@Module({
  imports: [
    SyncModule,
    CatalogModule,
    AccessModule,
    InventoryModule,
    OrdersModule,
  ],
  controllers: [TrendyolController],
  providers: [
    {
      provide: TRENDYOL_ADAPTER,
      useFactory: () =>
        new TrendyolAdapter(trendyolBaseUrl(process.env.TRENDYOL_API_BASE)),
    },
    TrendyolProductsSync,
    TrendyolStockPriceSync,
    TrendyolStockPricePush,
    TrendyolOrdersSync,
  ],
})
export class TrendyolModule {}
