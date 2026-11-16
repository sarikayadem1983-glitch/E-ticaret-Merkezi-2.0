import { Module } from '@nestjs/common';
import { loadStorageConfig, type StorageConfig } from './storage.config.js';
import {
  createS3Client,
  defaultSigner,
  STORAGE_CLIENT,
  STORAGE_CONFIG,
  STORAGE_SIGNER,
  StorageService,
} from './storage.service.js';

@Module({
  providers: [
    // process.env already holds .env (ConfigModule loads it first). Invalid settings stop
    // the app; missing settings disable storage outside production.
    {
      provide: STORAGE_CONFIG,
      useFactory: () => loadStorageConfig(process.env),
    },
    {
      provide: STORAGE_CLIENT,
      inject: [STORAGE_CONFIG],
      useFactory: (config: StorageConfig | undefined) =>
        config ? createS3Client(config) : undefined,
    },
    { provide: STORAGE_SIGNER, useValue: defaultSigner },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
