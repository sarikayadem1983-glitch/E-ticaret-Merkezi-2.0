import { Module } from '@nestjs/common';
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

/** Trendyol sync kinds (INT-TY-*). Registers them with the INT-02 engine. */
@Module({
  imports: [SyncModule, CatalogModule],
  controllers: [TrendyolController],
  providers: [
    {
      provide: TRENDYOL_ADAPTER,
      useFactory: () =>
        new TrendyolAdapter(trendyolBaseUrl(process.env.TRENDYOL_API_BASE)),
    },
    TrendyolProductsSync,
  ],
})
export class TrendyolModule {}
